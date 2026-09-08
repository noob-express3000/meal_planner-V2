const DB_NAME = "the-watchlist";
const DB_VERSION = 1;
const toolControllers = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("media")) {
        db.createObjectStore("media", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("events")) {
        const events = db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
        events.createIndex("media_id", "media_id", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

async function getSetting(key) {
  const db = await openDatabase();
  const tx = db.transaction("settings", "readonly");
  const value = await requestResult(tx.objectStore("settings").get(key));
  db.close();
  return value?.value ?? null;
}

async function putSetting(key, value) {
  const db = await openDatabase();
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put({ key, value });
  await transactionDone(tx);
  db.close();
}

async function getAllMedia() {
  const db = await openDatabase();
  const tx = db.transaction("media", "readonly");
  const rows = await requestResult(tx.objectStore("media").getAll());
  db.close();
  return rows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at.localeCompare(b.created_at));
}

async function getMedia(id) {
  const db = await openDatabase();
  const tx = db.transaction("media", "readonly");
  const row = await requestResult(tx.objectStore("media").get(id));
  db.close();
  return row || null;
}

async function putMedia(row) {
  const db = await openDatabase();
  const tx = db.transaction("media", "readwrite");
  tx.objectStore("media").put(row);
  await transactionDone(tx);
  db.close();
  return row;
}

async function removeMedia(id) {
  const db = await openDatabase();
  const tx = db.transaction(["media", "events"], "readwrite");
  tx.objectStore("media").delete(id);
  const eventStore = tx.objectStore("events");
  const index = eventStore.index("media_id");
  const request = index.openCursor(IDBKeyRange.only(id));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await transactionDone(tx);
  db.close();
}

async function appendEvent(mediaId, event, metadata = {}) {
  const db = await openDatabase();
  const tx = db.transaction("events", "readwrite");
  tx.objectStore("events").add({
    media_id: mediaId,
    event,
    metadata,
    created_at: new Date().toISOString(),
  });
  await transactionDone(tx);
  db.close();
}

async function getAllEvents() {
  const db = await openDatabase();
  const tx = db.transaction("events", "readonly");
  const rows = await requestResult(tx.objectStore("events").getAll());
  db.close();
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function clearSurface() {
  const db = await openDatabase();
  const tx = db.transaction(["settings", "media", "events"], "readwrite");
  tx.objectStore("settings").clear();
  tx.objectStore("media").clear();
  tx.objectStore("events").clear();
  await transactionDone(tx);
  db.close();
}

function queueItems(media) {
  return media.filter((item) => item.status === "queued" || item.status === "started");
}

function historyItems(media) {
  return media
    .filter((item) => ["completed", "skipped", "abandoned"].includes(item.status))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

async function getState() {
  const [goal, media, events] = await Promise.all([
    getSetting("goal"),
    getAllMedia(),
    getAllEvents(),
  ]);
  const queue = queueItems(media);
  return {
    goal,
    up_next: queue[0] || null,
    watchlist: queue,
    history: historyItems(media),
    events,
  };
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function addMedia(input) {
  const media = await getAllMedia();
  const now = new Date().toISOString();
  const row = {
    id: input.id || makeId(),
    title: input.title,
    media_type: input.media_type || "",
    provider: input.provider || "",
    url: input.url || "",
    category: input.category || "",
    purpose: input.purpose || "",
    reason: input.reason || "",
    thumbnail: input.thumbnail || "",
    alt_text: input.alt_text || "",
    status: input.status || "queued",
    position: Number.isInteger(input.position) ? input.position : media.length,
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
  };
  return putMedia(row);
}

async function updateMedia(id, changes) {
  const current = await getMedia(id);
  if (!current) throw new Error("Media not found");
  const row = {
    ...current,
    ...changes,
    id,
    updated_at: new Date().toISOString(),
  };
  return putMedia(row);
}

async function reorderMedia(ids) {
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate media ids");
  const media = await getAllMedia();
  const byId = new Map(media.map((item) => [item.id, item]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`Unknown media ids: ${missing.join(", ")}`);

  const now = new Date().toISOString();
  const listed = new Set(ids);
  const remaining = media.filter((item) => !listed.has(item.id));
  const ordered = [...ids.map((id) => byId.get(id)), ...remaining];

  const db = await openDatabase();
  const tx = db.transaction("media", "readwrite");
  const store = tx.objectStore("media");
  ordered.forEach((item, position) => store.put({ ...item, position, updated_at: now }));
  await transactionDone(tx);
  db.close();
  return getAllMedia();
}

async function recordInteraction(id, event, metadata = {}) {
  const current = await getMedia(id);
  if (!current) throw new Error("Media not found");

  const now = new Date().toISOString();
  const changes = { updated_at: now };
  if (event === "started") {
    changes.status = "started";
    changes.started_at = current.started_at || now;
  } else if (event === "completed") {
    changes.status = "completed";
    changes.completed_at = now;
  } else if (event === "skipped") {
    changes.status = "skipped";
  } else if (event === "abandoned") {
    changes.status = "abandoned";
  }

  const updated = await putMedia({ ...current, ...changes });
  await appendEvent(id, event, metadata);
  return updated;
}

function action(label, handler, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action${primary ? " primary" : ""}`;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderPoster(container, item) {
  container.replaceChildren();
  if (!item.thumbnail) return;
  const image = document.createElement("img");
  image.src = item.thumbnail;
  image.alt = item.alt_text || item.title;
  image.loading = "lazy";
  container.append(image);
}

function metaText(item) {
  return [item.media_type, item.category || item.purpose, item.provider].filter(Boolean).join(" · ");
}

async function startItem(item) {
  await recordInteraction(item.id, "started", { source: "human" });
  await refresh();
  if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
}

async function completeItem(item) {
  await recordInteraction(item.id, "completed", { source: "human" });
  await refresh();
}

async function skipItem(item) {
  await recordInteraction(item.id, "skipped", { source: "human" });
  await refresh();
}

async function returnItem(item) {
  await updateMedia(item.id, { status: "queued", completed_at: null });
  await refresh();
}

function renderHero(item) {
  const fragment = $("#hero-template").content.cloneNode(true);
  const hero = fragment.querySelector(".hero");
  const poster = fragment.querySelector(".poster");
  const meta = fragment.querySelector(".meta");
  const title = fragment.querySelector(".title");
  const reason = fragment.querySelector(".reason");
  const actions = fragment.querySelector(".actions");

  renderPoster(poster, item);
  meta.textContent = metaText(item);
  meta.hidden = !meta.textContent;
  title.textContent = item.title;
  reason.textContent = item.reason || item.purpose || "";
  reason.hidden = !reason.textContent;

  if (item.status === "started") {
    actions.append(action("Complete", () => completeItem(item), true));
    actions.append(action("Abandon", async () => {
      await recordInteraction(item.id, "abandoned", { source: "human" });
      await refresh();
    }));
  } else {
    actions.append(action(item.url ? "Watch" : "Start", () => startItem(item), true));
    actions.append(action("Skip", () => skipItem(item)));
  }

  return hero;
}

function renderCard(item, history = false) {
  const fragment = $("#card-template").content.cloneNode(true);
  const card = fragment.querySelector(".media-card");
  const poster = fragment.querySelector(".poster");
  const meta = fragment.querySelector(".meta");
  const title = fragment.querySelector(".title");
  const actions = fragment.querySelector(".actions");

  renderPoster(poster, item);
  meta.textContent = history ? item.status : metaText(item);
  meta.hidden = !meta.textContent;
  title.textContent = item.title;

  if (history) {
    actions.append(action("Return", () => returnItem(item)));
  } else if (item.status === "started") {
    actions.append(action("Complete", () => completeItem(item)));
  } else {
    actions.append(action("Start", () => startItem(item)));
    actions.append(action("Skip", () => skipItem(item)));
  }

  return card;
}

function emptyState() {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = "—";
  return element;
}

function setCount(selector, count) {
  $(selector).textContent = count ? String(count) : "";
}

function render(state) {
  const goal = $("#goal");
  if (state.goal?.goal) {
    goal.textContent = state.goal.goal;
    goal.hidden = false;
  } else {
    goal.textContent = "";
    goal.hidden = true;
  }

  setCount("#queue-count", state.watchlist.length);
  setCount("#history-count", state.history.length);

  const upNext = $("#up-next");
  upNext.replaceChildren(state.up_next ? renderHero(state.up_next) : emptyState());

  const watchlist = $("#watchlist");
  watchlist.replaceChildren();
  if (state.watchlist.length) {
    state.watchlist.forEach((item) => watchlist.append(renderCard(item)));
  } else {
    watchlist.append(emptyState());
  }

  const history = $("#history");
  history.replaceChildren();
  if (state.history.length) {
    state.history.forEach((item) => history.append(renderCard(item, true)));
  } else {
    history.append(emptyState());
  }
}

async function refresh() {
  render(await getState());
}

function selectTab(name, focus = false) {
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });

  $$(".tab-panel").forEach((panel) => {
    const active = panel.dataset.panel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function setupTabs() {
  const tabs = $$(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      const current = tabs.indexOf(tab);
      let target = null;
      if (event.key === "ArrowRight") target = tabs[(current + 1) % tabs.length];
      if (event.key === "ArrowLeft") target = tabs[(current - 1 + tabs.length) % tabs.length];
      if (event.key === "Home") target = tabs[0];
      if (event.key === "End") target = tabs[tabs.length - 1];
      if (!target) return;
      event.preventDefault();
      selectTab(target.dataset.tab, true);
    });
  });
  selectTab("up-next");
}

function result(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function modelContext() {
  return document.modelContext || navigator.modelContext || null;
}

async function registerWebMCPTools() {
  const mc = modelContext();
  const status = $("#agent-status");
  status.title = "WebMCP unavailable";
  if (!mc?.registerTool) return;

  const register = async (tool) => {
    const controller = new AbortController();
    toolControllers.push(controller);
    await mc.registerTool(tool, { signal: controller.signal });
  };

  const tools = [
    {
      name: "watchlist_get_state",
      description: "Read the human's locally stored goal, current queue, history, thumbnails, and interaction events.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => result(await getState()),
    },
    {
      name: "watchlist_set_goal",
      description: "Set the goal this media surface currently supports. The value is stored only in the browser.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string", minLength: 1 },
          context: { type: "string" },
        },
        required: ["goal"],
        additionalProperties: false,
      },
      execute: async ({ goal, context = "" }) => {
        const value = { goal, context, updated_at: new Date().toISOString() };
        await putSetting("goal", value);
        await refresh();
        return result(value);
      },
    },
    {
      name: "watchlist_add_media",
      description: "Add media to the local watch surface. Supply only fields you know. Thumbnail may be a URL or data URL; alt_text should describe it for accessibility.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string", minLength: 1 },
          media_type: { type: "string" },
          provider: { type: "string" },
          url: { type: "string" },
          category: { type: "string" },
          purpose: { type: "string" },
          reason: { type: "string" },
          thumbnail: { type: "string" },
          alt_text: { type: "string" },
          position: { type: "integer", minimum: 0 },
          status: { type: "string", enum: ["queued", "started", "completed", "skipped", "abandoned"] },
        },
        required: ["title"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const item = await addMedia(input);
        await refresh();
        return result(item);
      },
    },
    {
      name: "watchlist_update_media",
      description: "Update an existing locally stored media item, including its thumbnail, accessibility text, metadata, URL, status, or position.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          media_type: { type: "string" },
          provider: { type: "string" },
          url: { type: "string" },
          category: { type: "string" },
          purpose: { type: "string" },
          reason: { type: "string" },
          thumbnail: { type: "string" },
          alt_text: { type: "string" },
          position: { type: "integer", minimum: 0 },
          status: { type: "string", enum: ["queued", "started", "completed", "skipped", "abandoned"] },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async ({ id, ...changes }) => {
        const item = await updateMedia(id, changes);
        await refresh();
        return result(item);
      },
    },
    {
      name: "watchlist_remove_media",
      description: "Remove one media item and its interaction events from local browser storage.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async ({ id }) => {
        await removeMedia(id);
        await refresh();
        return result({ removed: id });
      },
    },
    {
      name: "watchlist_reorder",
      description: "Reorder locally stored media. IDs are supplied from highest to lowest priority.",
      inputSchema: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true },
        },
        required: ["ids"],
        additionalProperties: false,
      },
      execute: async ({ ids }) => {
        const media = await reorderMedia(ids);
        await refresh();
        return result(media);
      },
    },
    {
      name: "watchlist_record_interaction",
      description: "Record that the human started, watched, completed, skipped, or abandoned a media item. The event stays in local browser storage.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          event: { type: "string", enum: ["started", "watched", "completed", "skipped", "abandoned"] },
          metadata: { type: "object" },
        },
        required: ["id", "event"],
        additionalProperties: false,
      },
      execute: async ({ id, event, metadata = {} }) => {
        const item = await recordInteraction(id, event, { ...metadata, source: "agent" });
        await refresh();
        return result(item);
      },
    },
    {
      name: "watchlist_clear_surface",
      description: "Clear the local goal, media, thumbnails and interaction history from this browser. Requires explicit confirmation.",
      inputSchema: {
        type: "object",
        properties: { confirm: { type: "boolean" } },
        required: ["confirm"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true },
      execute: async ({ confirm }) => {
        if (confirm !== true) throw new Error("Explicit confirmation required");
        await clearSurface();
        await refresh();
        return result({ cleared: true });
      },
    },
  ];

  for (const tool of tools) await register(tool);
  status.classList.add("connected");
  status.title = `WebMCP connected · ${tools.length} tools`;
}

setupTabs();
refresh().catch(console.error);
registerWebMCPTools().catch((error) => {
  console.error("WebMCP registration failed", error);
  const status = $("#agent-status");
  status.classList.remove("connected");
  status.title = "WebMCP registration failed";
});
window.addEventListener("watchlist:refresh", () => refresh().catch(console.error));
window.addEventListener("pagehide", () => toolControllers.forEach((controller) => controller.abort()));
