(() => {
  const registered = new Set();
  const attempted = new Set();
  let revision = 0;

  async function syncStatus() {
    const current = ++revision;
    const status = document.querySelector("#mcpStatus");
    if (!status) return;
    const context = document.modelContext;
    if (!context?.registerTool) {
      status.textContent = "WebMCP unavailable";
      status.classList.remove("ready");
      status.title = "Use a browser and external agent with WebMCP support. The human interface still works.";
      return;
    }
    let names = registered;
    let discovered = false;
    if (context.getTools) {
      try {
        const tools = await context.getTools();
        if (Array.isArray(tools)) {
          names = new Set(tools.map((tool) => tool.name).filter((name) => attempted.has(name)));
          discovered = true;
        }
      } catch { /* Successful registrations remain the fallback count. */ }
    }
    if (current !== revision) return;
    const complete = attempted.size > 0 && names.size === attempted.size;
    status.textContent = `WebMCP · ${complete ? names.size : `${names.size}/${attempted.size}`} tools`;
    status.classList.toggle("ready", complete);
    status.title = complete
      ? (discovered ? "All page tools are discoverable by the browser." : "All page tools registered; browser discovery is unavailable.")
      : "Some page tools are unavailable. Check browser support and the console before an agent demo.";
  }

  globalThis.registerMealTool = async (tool) => {
    attempted.add(tool.name);
    try {
      await document.modelContext.registerTool(tool);
      registered.add(tool.name);
    } finally {
      syncStatus();
    }
  };
  document.modelContext?.addEventListener?.("toolchange", syncStatus);
  document.addEventListener("DOMContentLoaded", syncStatus, { once: true });
})();
