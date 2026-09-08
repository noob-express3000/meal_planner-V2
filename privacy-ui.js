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

  function sanitizeLocationEchoes() {
    const location = savedLocation();
    if (!location) return;

    const summary = document.querySelector("#shoppingPriceSummary");
    if (!summary) return;

    summary.querySelectorAll("small").forEach((node) => {
      const text = node.textContent || "";
      if (!text.includes(location)) return;

      if (text.startsWith("No saved prices for ")) {
        node.textContent = "No saved prices yet.";
        return;
      }

      node.textContent = text
        .replace(` · ${location}`, "")
        .replace(location, "")
        .replace(/\s+·\s*$/, "")
        .trim();
    });
  }

  function install() {
    sanitizeLocationEchoes();
    const observer = new MutationObserver(sanitizeLocationEchoes);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
