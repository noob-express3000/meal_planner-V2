(() => {
  const STORAGE_KEY = "meal-planner.sources.v1";
  const SOURCE_TYPES = ["video", "article", "reference"];

  const $ = (selector, root = document) => root.querySelector(selector);

  let sourceLoadFailed = false;

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed) return { version: 1, sources: [] };
      if (parsed.version !== 1 || !Array.isArray(parsed.sources)) throw new Error("Invalid source data");
      const ids = new Set();
      const sources = parsed.sources.map((source) => {
        if (!source || !SOURCE_TYPES.includes(source.type) || !source.id || ids.has(source.id)) throw new Error("Invalid source data");
        ids.add(source.id);
        return { ...source, title: requireText(source.title, "Source title"), url: normalizeUrl(source.url) };
      });
      return { version: 1, sources };
    } catch { sourceLoadFailed = true; }
    return { version: 1, sources: [] };
  }

  let sourceStore = loadStore();
  let committedSources = clone(sourceStore);

  function persistSources() {
    try {
      if (sourceLoadFailed) throw new Error("Unreadable source data");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sourceStore));
    } catch {
      sourceStore = clone(committedSources);
      throw new Error("Could not save Sources. Check saved data, browser storage space and permissions; changes were not saved.");
    }
    committedSources = clone(sourceStore);
    renderSources();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function requireText(value, label) {
    const text = cleanText(value);
    if (!text) throw new Error(`${label} is required.`);
    return text;
  }

  function normalizeUrl(value) {
    const raw = requireText(value, "Source URL");
    let url;
    try { url = new URL(raw); } catch { throw new Error("Enter a valid source URL."); }
    if (url.username || url.password) throw new Error("Source URLs must not contain credentials.");
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Source URL must use http or https.");
    return url.toString();
  }

  function inferProvider(url) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "youtu.be" || (host === "youtube.com" || host.endsWith(".youtube.com"))) return "YouTube";
    if ((host === "vimeo.com" || host.endsWith(".vimeo.com"))) return "Vimeo";
    return host;
  }

  function inferType(url, requestedType) {
    if (SOURCE_TYPES.includes(requestedType)) return requestedType;
    const parsed = new URL(url);
    if (/^(?:youtu\.be|(?:[a-z0-9-]+\.)*(?:youtube\.com|vimeo\.com))$/i.test(parsed.hostname.replace(/^www\./, ""))) return "video";
    if (/\.(mp4|webm|ogg)(?:$|\?)/i.test(parsed.pathname + parsed.search)) return "video";
    return "article";
  }

  function saveSource(input) {
    const url = normalizeUrl(input.url);
    const existing = input.id ? sourceStore.sources.find((item) => item.id === input.id) : null;
    if (input.id && !existing) throw new Error("Source not found.");
    const relation = cleanText(input.recipe_id || input.recipeId);
    if (relation && !recipeById(relation)) throw new Error("Linked recipe not found.");
    const now = new Date().toISOString();
    const source = {
      id: existing?.id || (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      title: requireText(input.title, "Source title"),
      url,
      type: inferType(url, input.type),
      provider: cleanText(input.provider) || inferProvider(url),
      note: cleanText(input.note),
      recipeId: relation,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    if (existing) sourceStore.sources = sourceStore.sources.map((item) => item.id === source.id ? source : item);
    else sourceStore.sources.unshift(source);
    persistSources();
    return clone(source);
  }

  function listSources({ type = "", recipe_id = "" } = {}) {
    return clone(sourceStore.sources.filter((item) =>
      (!type || item.type === type) && (!recipe_id || item.recipeId === recipe_id)
    ));
  }

  function deleteSource(id) {
    const before = sourceStore.sources.length;
    sourceStore.sources = sourceStore.sources.filter((item) => item.id !== id);
    if (sourceStore.sources.length === before) throw new Error("Source not found.");
    persistSources();
    return { deletedSourceId: id };
  }

  function youtubeEmbedUrl(value) {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
    if ((host === "youtube.com" || host.endsWith(".youtube.com"))) {
      if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      if (url.pathname.startsWith("/shorts/")) id = url.pathname.split("/")[2] || "";
      if (url.pathname.startsWith("/embed/")) id = url.pathname.split("/")[2] || "";
    }
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
  }

  function vimeoEmbedUrl(value) {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    if (!(host === "vimeo.com" || host.endsWith(".vimeo.com"))) return null;
    const id = url.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part));
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }

  function createMedia(source) {
    if (source.type !== "video") return null;
    const embedUrl = youtubeEmbedUrl(source.url) || vimeoEmbedUrl(source.url);
    if (embedUrl) {
      const frame = document.createElement("iframe");
      frame.className = "source-video";
      frame.src = embedUrl;
      frame.title = source.title;
      frame.loading = "lazy";
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      return frame;
    }

    if (/\.(mp4|webm|ogg)(?:$|\?)/i.test(new URL(source.url).pathname + new URL(source.url).search)) {
      const video = document.createElement("video");
      video.className = "source-video";
      video.src = source.url;
      video.controls = true;
      video.preload = "none";
      video.setAttribute("aria-label", source.title);
      return video;
    }
    return null;
  }

  function recipeName(recipeId) {
    if (!recipeId) return "";
    try { return typeof recipeById === "function" ? recipeById(recipeId)?.name || "" : ""; }
    catch { return ""; }
  }

  function sourceCard(source) {
    const card = document.createElement("article");
    card.className = "source-card";

    const media = createMedia(source);
    if (media) card.append(media);

    const body = document.createElement("div");
    body.className = "source-card-body";

    const meta = document.createElement("div");
    meta.className = "source-meta";
    const relation = recipeName(source.recipeId);
    meta.textContent = [source.type, source.provider, relation ? `for ${relation}` : ""].filter(Boolean).join(" · ");

    const title = document.createElement("h3");
    title.textContent = source.title;

    body.append(meta, title);

    if (source.note) {
      const note = document.createElement("p");
      note.textContent = source.note;
      body.append(note);
    }

    const actions = document.createElement("div");
    actions.className = "source-actions";

    const open = document.createElement("a");
    open.className = "button ghost";
    open.href = source.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = media ? "Open source" : "Read source";

    const remove = document.createElement("button");
    remove.className = "button ghost";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      try {
        deleteSource(source.id);
        showToast("Source removed");
      } catch (error) { showToast(error.message); }
    });

    actions.append(open, remove);
    body.append(actions);
    card.append(body);
    return card;
  }

  function renderSources() {
    const list = $("#sourceList");
    if (!list) return;
    list.replaceChildren();
    if (sourceLoadFailed) {
      list.textContent = "Saved Sources could not be read. Existing storage was preserved.";
      return;
    }
    if (!sourceStore.sources.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const strong = document.createElement("strong");
      strong.textContent = "No sources";
      empty.append(strong);
      list.append(empty);
      return;
    }
    sourceStore.sources.forEach((source) => list.append(sourceCard(source)));
  }

  function refreshRecipeOptions() {
    const select = $("#sourceRecipe");
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option("Not linked to a recipe", ""));
    try {
      if (typeof state !== "undefined" && Array.isArray(state.recipes)) {
        [...state.recipes].sort((a, b) => a.name.localeCompare(b.name)).forEach((recipe) => {
          select.append(new Option(recipe.name, recipe.id));
        });
      }
    } catch {}
    select.value = selected;
  }

  function bindSourcesUI() {
    const addButton = $("#addSourceButton");
    const dialog = $("#sourceDialog");
    const form = $("#sourceForm");
    if (!addButton || !dialog || !form) return;

    addButton.addEventListener("click", () => {
      form.reset();
      $("#sourceId").value = "";
      refreshRecipeOptions();
      dialog.showModal();
    });

    document.querySelectorAll("[data-close-source-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        saveSource({
          id: $("#sourceId").value || undefined,
          title: $("#sourceTitle").value,
          url: $("#sourceUrl").value,
          type: $("#sourceType").value,
          note: $("#sourceNote").value,
          recipe_id: $("#sourceRecipe").value
        });
        dialog.close();
        if (typeof showToast === "function") showToast("Source saved");
      } catch (error) {
        alert(error.message);
      }
    });
  }

  function toolResult(data, message) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, message, data }) }] };
  }

  function toolFailure(error) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) }], isError: true };
  }

  async function registerSourceTools() {
    if (!document.modelContext?.registerTool) return;
    const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
    const string = (description) => ({ type: "string", description });
    const tools = [
      {
        name: "list_sources",
        description: "Read videos, articles and references saved in the local Sources library. Sources can optionally be linked to a saved recipe for provenance.",
        inputSchema: object({
          type: { type: "string", enum: ["", ...SOURCE_TYPES], description: "Optional source type filter" },
          recipe_id: string("Optional recipe ID filter")
        }),
        execute: (input) => toolResult(listSources(input), "Sources loaded.")
      },
      {
        name: "save_source",
        description: "Create or update a source in browser-local storage. Use this to leave behind the video, article or reference used for a recommendation or recipe. YouTube and Vimeo video URLs render as playable embeds in the Sources tab.",
        inputSchema: object({
          id: string("Existing source ID when updating; omit for a new source"),
          title: string("Human-readable source title"),
          url: string("HTTP or HTTPS source URL"),
          type: { type: "string", enum: SOURCE_TYPES, description: "Source type" },
          provider: string("Optional publisher or platform name; inferred from the URL when omitted"),
          note: string("Optional short explanation of why this source matters"),
          recipe_id: string("Optional saved recipe ID this source supports")
        }, ["title", "url", "type"]),
        execute: (input) => toolResult(saveSource(input), "Source saved.")
      },
      {
        name: "delete_source",
        description: "Remove one saved source without changing recipes, pantry or meal plans.",
        inputSchema: object({ source_id: string("Saved source ID") }, ["source_id"]),
        execute: ({ source_id }) => toolResult(deleteSource(source_id), "Source deleted.")
      }
    ];

    for (const tool of tools) {
      try {
        await registerMealTool({
          ...tool,
          execute: async (input) => {
            try { return await tool.execute(input || {}); }
            catch (error) { return toolFailure(error); }
          }
        });
      } catch (error) {
        console.error(`WebMCP registration failed for ${tool.name}`, error);
      }
    }
  }

  document.addEventListener("mealstatechange", renderSources);
  renderSources();
  bindSourcesUI();
  registerSourceTools();
})();
