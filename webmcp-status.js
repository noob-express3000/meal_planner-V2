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

// Privacy guard: a saved shopping location remains available to pricing tools,
// but should not be echoed into user-facing status/error text during demos.
(() => {
  const PRICING_KEY = "meal-planner.shopping-pricing.v1";

  function savedLocation() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRICING_KEY) || "null");
      return typeof parsed?.location === "string" ? parsed.location.trim() : "";
    } catch {
      return "";
    }
  }

  function redact(value) {
    const text = String(value ?? "");
    const location = savedLocation();
    if (!location) return text;
    return text.split(location).join("saved location");
  }

  function sanitizeVisibleStatus() {
    const location = savedLocation();
    if (!location) return;

    const summary = document.querySelector("#shoppingPriceSummary");
    summary?.querySelectorAll("small").forEach((node) => {
      const text = node.textContent || "";
      if (!text.includes(location)) return;
      if (text.startsWith("No saved prices for ")) {
        node.textContent = "No saved prices yet.";
      } else {
        node.textContent = text
          .replace(` · ${location}`, "")
          .replace(location, "")
          .replace(/\s+·\s*$/, "")
          .trim();
      }
    });

    [document.querySelector("#toast"), document.querySelector("#mcpStatus")]
      .filter(Boolean)
      .forEach((node) => {
        if (node.textContent?.includes(location)) node.textContent = redact(node.textContent);
      });
  }

  const originalAlert = globalThis.alert?.bind(globalThis);
  if (originalAlert) globalThis.alert = (message) => originalAlert(redact(message));

  function install() {
    sanitizeVisibleStatus();
    new MutationObserver(sanitizeVisibleStatus)
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
