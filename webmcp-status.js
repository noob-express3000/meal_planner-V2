(() => {
  const context = document.modelContext;
  if (!context?.getTools) return;

  let syncing = false;

  async function syncStatus() {
    if (syncing) return;
    syncing = true;
    try {
      const tools = await context.getTools();
      const status = document.querySelector("#mcpStatus");
      if (!status) return;
      const count = Array.isArray(tools) ? tools.length : 0;
      if (count > 0) {
        const text = `WebMCP · ${count} tools`;
        if (status.textContent !== text) status.textContent = text;
        status.classList.add("ready");
        status.title = "This page is exposing structured tools to your browser agent.";
      }
    } catch (error) {
      console.debug("WebMCP tool count unavailable", error);
    } finally {
      syncing = false;
    }
  }

  context.addEventListener?.("toolchange", syncStatus);

  const observeStatus = () => {
    const status = document.querySelector("#mcpStatus");
    if (!status) return;
    new MutationObserver(() => queueMicrotask(syncStatus))
      .observe(status, { childList: true, subtree: true, characterData: true });
    syncStatus();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeStatus, { once: true });
  } else {
    observeStatus();
  }
})();
