(() => {
  const UNKNOWN_CURRENCY = "XXX";
  const pricingApi = globalThis.mealPlannerPricing;
  if (!pricingApi?.getContext || !pricingApi?.setProfile) return;

  const clean = (value) => String(value ?? "").trim();

  function currentProfile() {
    const context = pricingApi.getContext();
    return {
      location: clean(context.location),
      preferredStores: Array.isArray(context.preferredStores) ? context.preferredStores : []
    };
  }

  function setCurrency(currency) {
    const profile = currentProfile();
    const code = clean(currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || code === UNKNOWN_CURRENCY) {
      throw new Error("currency must be a real three-letter ISO 4217 code.");
    }
    return pricingApi.setProfile({
      location: profile.location,
      preferred_stores: profile.preferredStores,
      currency: code
    });
  }

  async function registerCurrencyTool() {
    if (!document.modelContext?.registerTool) return;
    try {
      await registerMealTool({
        name: "set_shopping_currency",
        description: "Set the ISO 4217 currency used for grocery prices. Use the currency explicitly chosen by the user. Do not request or infer device geolocation. Changing currency clears old quotes.",
        inputSchema: {
          type: "object",
          properties: {
            currency: {
              type: "string",
              pattern: "^[A-Z]{3}$",
              description: "Three-letter ISO 4217 currency code chosen by the user"
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
    } catch (error) {
      console.error("WebMCP currency tool registration failed", error);
    }
  }

  registerCurrencyTool();
})();
