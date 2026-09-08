(() => {
  const UNKNOWN_CURRENCY = "XXX";
  const pricingApi = globalThis.mealPlannerPricing;
  if (!pricingApi?.getContext || !pricingApi?.setProfile) return;

  const clean = (value) => String(value ?? "").trim();
  const normalize = (value) => clean(value).toLocaleLowerCase().replace(/\s+/g, " ");

  function currentProfile() {
    const context = pricingApi.getContext();
    return {
      location: clean(context.location),
      preferredStores: Array.isArray(context.preferredStores) ? context.preferredStores : [],
      currency: clean(context.currency).toUpperCase(),
      savedQuotes: Array.isArray(context.savedQuotes) ? context.savedQuotes : []
    };
  }

  function setCurrency(currency) {
    const profile = currentProfile();
    const code = clean(currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || code === UNKNOWN_CURRENCY) {
      throw new Error("currency must be a real three-letter ISO 4217 code such as USD, EUR, GBP, ZAR or MGA.");
    }
    return pricingApi.setProfile({
      location: profile.location,
      preferred_stores: profile.preferredStores,
      currency: code
    });
  }

  // The original pricing module predates global localization and used ZAR as its
  // empty-state default. New/unpriced profiles are now explicitly unresolved so
  // the agent, rather than the website, chooses currency from the user's location.
  const initial = currentProfile();
  if (initial.currency === "ZAR" && initial.savedQuotes.length === 0) {
    pricingApi.setProfile({
      location: initial.location,
      preferred_stores: initial.preferredStores,
      currency: UNKNOWN_CURRENCY
    });
  }

  const form = document.querySelector("#shoppingPriceControls");
  if (form) {
    form.addEventListener("submit", () => {
      const profile = currentProfile();
      const nextLocation = clean(document.querySelector("#shoppingLocation")?.value);
      const nextStores = clean(document.querySelector("#shoppingStores")?.value)
        .split(",")
        .map(clean)
        .filter(Boolean);

      if (normalize(nextLocation) !== normalize(profile.location)) {
        pricingApi.setProfile({
          location: nextLocation,
          preferred_stores: nextStores,
          currency: UNKNOWN_CURRENCY
        });
      }
    }, true);
  }

  // Replace the original button to remove its older location-agnostic prompt.
  const oldPromptButton = document.querySelector("#copyPricingPrompt");
  if (oldPromptButton) {
    const promptButton = oldPromptButton.cloneNode(true);
    oldPromptButton.replaceWith(promptButton);
    promptButton.addEventListener("click", async () => {
      const prompt = "Using this page's WebMCP tools, read my shopping price context. Infer the correct local ISO 4217 currency from my saved shopping location and set it with set_shopping_currency. Then find current prices and relevant promotions for the ingredients on my shopping list near that location and my preferred stores, save those price quotes back to the page, and tell me the estimated basket total and cheapest useful deals. Do not change my recipes or meal plan.";
      try {
        await navigator.clipboard.writeText(prompt);
        showToast("Pricing prompt copied");
      } catch {
        showToast("Ask your agent to price the current shopping list");
      }
    });
  }

  async function registerCurrencyTool() {
    if (!document.modelContext?.registerTool) return;
    try {
      await document.modelContext.registerTool({
        name: "set_shopping_currency",
        description: "Set the ISO 4217 currency used for grocery prices. Infer this from the user's explicitly saved shopping location before researching or saving prices. For example use USD for the United States, MGA for Madagascar, ZAR for South Africa, GBP for the United Kingdom, and JPY for Japan. Do not infer or request device geolocation; use only the location saved in shopping_price_context.",
        inputSchema: {
          type: "object",
          properties: {
            currency: {
              type: "string",
              pattern: "^[A-Z]{3}$",
              description: "Three-letter ISO 4217 currency code appropriate to the saved shopping location"
            }
          },
          required: ["currency"],
          additionalProperties: false
        },
        execute: async ({ currency } = {}) => {
          try {
            const data = setCurrency(currency);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ ok: true, message: `Shopping currency set to ${data.currency}.`, data })
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) }],
              isError: true
            };
          }
        }
      });

      const status = document.querySelector("#mcpStatus");
      const existing = Number(status?.textContent?.match(/(\d+)(?:\/\d+)?\s*tools?/)?.[1] || 0);
      if (status && existing) status.textContent = `WebMCP · ${existing + 1} tools`;
    } catch (error) {
      console.error("WebMCP currency tool registration failed", error);
    }
  }

  setTimeout(registerCurrencyTool, 0);
})();