const state = { data: null };
const toolControllers = [];

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail ? JSON.stringify(body.detail) : JSON.stringify(body);
    } catch (_) {}
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

function action(label, onClick, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action${primary ? " primary" : ""}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function interact(id, event) {
  await api(`/api/recommendations/${id}/interaction`, {
    method: "POST",
    body: JSON.stringify({ event }),
  });
  await refresh();
}

function mediaRow(item, index, { upNext = false, history = false } = {}) {
  const fragment = $("#media-template").content.cloneNode(true);
  const row = fragment.querySelector(".media-row");
  const rank = fragment.querySelector(".rank");
  const meta = fragment.querySelector(".meta");
  const title = fragment.querySelector(".title");
  const reason = fragment.querySelector(".reason");
  const actions = fragment.querySelector(".actions");

  rank.textContent = String(index + 1).padStart(2, "0");
  meta.textContent = [item.media_type, item.category, item.status].filter(Boolean).join(" · ");
  title.textContent = item.title;
  reason.textContent = item.reason;

  if (history) {
    if (item.status !== "completed") {
      actions.append(action("Return to queue", async () => {
        await api(`/api/recommendations/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "recommended" }),
        });
        await refresh();
      }));
    }
  } else {
    if (item.status === "recommended") {
      actions.append(action(upNext ? "Start" : "Start", () => interact(item.id, "started"), upNext));
    }
    if (item.status === "started") {
      actions.append(action("Complete", () => interact(item.id, "completed"), true));
      actions.append(action("Abandon", () => interact(item.id, "abandoned")));
    } else {
      actions.append(action("Complete", () => interact(item.id, "completed")));
      actions.append(action("Skip", () => interact(item.id, "skipped")));
    }
  }

  return row;
}

function render(data) {
  state.data = data;
  $("#goal").textContent = data.goal?.goal || "No active goal";
  $("#queue-count").textContent = `${data.watchlist.length} queued`;

  const upNext = $("#up-next");
  upNext.replaceChildren();
  if (data.up_next) {
    upNext.append(mediaRow(data.up_next, 0, { upNext: true }));
  } else {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Queue is clear.";
    upNext.append(empty);
  }

  const watchlist = $("#watchlist");
  watchlist.replaceChildren();
  const remaining = data.watchlist.slice(data.up_next ? 1 : 0);
  if (!remaining.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No additional recommendations.";
    watchlist.append(empty);
  } else {
    remaining.forEach((item, index) => watchlist.append(mediaRow(item, index + 1)));
  }

  const history = $("#history");
  history.replaceChildren();
  if (!data.history.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nothing here yet.";
    history.append(empty);
  } else {
    data.history.forEach((item, index) => history.append(mediaRow(item, index, { history: true })));
  }
}

async function refresh() {
  render(await api("/api/state"));
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
  if (!mc?.registerTool) return;

  const register = async (tool) => {
    const controller = new AbortController();
    toolControllers.push(controller);
    await mc.registerTool(tool, { signal: controller.signal });
  };

  const tools = [
    {
      name: "watchlist_get_state",
      description: "Read the active human goal, ordered watchlist, watch history, behavioral summary, and current next-watch prediction.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => result(await api("/api/state")),
    },
    {
      name: "watchlist_query_media",
      description: "Query recommendations by status, category, or associated goal.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["recommended", "started", "completed", "skipped", "abandoned"] },
          category: { type: "string" },
          goal: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input = {}) => {
        const params = new URLSearchParams();
        Object.entries(input).forEach(([key, value]) => value && params.set(key, value));
        return result(await api(`/api/recommendations?${params.toString()}`));
      },
    },
    {
      name: "watchlist_set_goal",
      description: "Set the human's active physical-world goal and optional context used to maintain the media environment.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string", minLength: 2 },
          context: { type: "string" },
        },
        required: ["goal"],
        additionalProperties: false,
      },
      execute: async ({ goal, context = "" }) => {
        const data = await api("/api/goal", {
          method: "PUT",
          body: JSON.stringify({ goal, context }),
        });
        await refresh();
        return result(data);
      },
    },
    {
      name: "watchlist_add_recommendation",
      description: "Add a watchable recommendation with its goal association, category, selection reason, relevance, and optional provider URL.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          media_type: { type: "string" },
          provider: { type: "string" },
          url: { type: "string" },
          category: { type: "string" },
          goal: { type: "string" },
          reason: { type: "string" },
          relevance: { type: "number", minimum: 0, maximum: 1 },
          priority: { type: "integer", minimum: 0 },
        },
        required: ["title", "media_type", "category", "goal", "reason"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const data = await api("/api/recommendations", {
          method: "POST",
          body: JSON.stringify(input),
        });
        await refresh();
        return result(data);
      },
    },
    {
      name: "watchlist_update_recommendation",
      description: "Update the metadata, status, relevance, or priority of an existing recommendation.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer", minimum: 1 },
          title: { type: "string" },
          media_type: { type: "string" },
          provider: { type: "string" },
          url: { type: "string" },
          category: { type: "string" },
          goal: { type: "string" },
          reason: { type: "string" },
          relevance: { type: "number", minimum: 0, maximum: 1 },
          priority: { type: "integer", minimum: 0 },
          status: { type: "string", enum: ["recommended", "started", "completed", "skipped", "abandoned"] },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async ({ id, ...changes }) => {
        const data = await api(`/api/recommendations/${id}`, {
          method: "PATCH",
          body: JSON.stringify(changes),
        });
        await refresh();
        return result(data);
      },
    },
    {
      name: "watchlist_remove_recommendation",
      description: "Remove a recommendation from the media environment by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "integer", minimum: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async ({ id }) => {
        await api(`/api/recommendations/${id}`, { method: "DELETE" });
        await refresh();
        return result({ removed: id });
      },
    },
    {
      name: "watchlist_reorder",
      description: "Set queue priority by supplying recommendation ids in desired order, highest priority first.",
      inputSchema: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, uniqueItems: true },
        },
        required: ["ids"],
        additionalProperties: false,
      },
      execute: async ({ ids }) => {
        const data = await api("/api/recommendations/reorder", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
        await refresh();
        return result(data);
      },
    },
    {
      name: "watchlist_record_interaction",
      description: "Record a human interaction with a recommendation: started, watched, completed, skipped, or abandoned. This updates state and preserves an event for later behavioral analysis.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer", minimum: 1 },
          event: { type: "string", enum: ["started", "watched", "completed", "skipped", "abandoned"] },
          metadata: { type: "object" },
        },
        required: ["id", "event"],
        additionalProperties: false,
      },
      execute: async ({ id, event, metadata = {} }) => {
        const data = await api(`/api/recommendations/${id}/interaction`, {
          method: "POST",
          body: JSON.stringify({ event, metadata }),
        });
        await refresh();
        return result(data);
      },
    },
  ];

  try {
    for (const tool of tools) await register(tool);
    status.textContent = `WebMCP · ${tools.length} tools exposed`;
  } catch (error) {
    console.error("WebMCP registration failed", error);
    status.textContent = "WebMCP registration failed";
  }
}

$("#refresh").addEventListener("click", refresh);
window.addEventListener("watchlist:refresh", refresh);
window.addEventListener("pagehide", () => toolControllers.forEach((controller) => controller.abort()));

refresh().catch(console.error);
registerWebMCPTools().catch(console.error);
