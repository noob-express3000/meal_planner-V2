(() => {
  const PRICING_KEY = "meal-planner.shopping-pricing.v1";
  const UNKNOWN_CURRENCY = "XXX";

  const clean = (value) => String(value ?? "").trim();
  const key = (value) => clean(value).toLocaleLowerCase().replace(/\s+/g, " ");
  const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  function freshPricing() {
    return {
      location: "",
      preferredStores: [],
      currency: UNKNOWN_CURRENCY,
      quotes: [],
      updatedAt: null
    };
  }

  let pricingLoadFailed = false;

  function loadPricing() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRICING_KEY) || "null");
      if (!parsed) return freshPricing();
      if (typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.quotes) || !Array.isArray(parsed.preferredStores)) throw new Error("Invalid pricing data");
      if (typeof parsed.location !== "string" || !/^[A-Z]{3}$/.test(parsed.currency)) throw new Error("Invalid pricing profile");
      for (const quote of parsed.quotes) {
        if (!quote || typeof quote.ingredient !== "string" || !quote.ingredient.trim() || typeof quote.store !== "string" || !Number.isFinite(quote.price) || quote.price < 0 || !Number.isFinite(quote.packageQuantity) || quote.packageQuantity <= 0) throw new Error("Invalid price quote");
        if (quote.validUntil) parseDateKey(quote.validUntil);
      }
      return {
        ...freshPricing(),
        ...parsed,
        preferredStores: Array.isArray(parsed.preferredStores) ? parsed.preferredStores.map(clean).filter(Boolean) : [],
        quotes: Array.isArray(parsed.quotes) ? parsed.quotes : []
      };
    } catch {
      pricingLoadFailed = true;
      return freshPricing();
    }
  }

  let pricing = loadPricing();
  let committedPricing = clone(pricing);

  function persistPricing() {
    pricing.updatedAt = new Date().toISOString();
    try {
      if (pricingLoadFailed) throw new Error("Unreadable pricing data");
      localStorage.setItem(PRICING_KEY, JSON.stringify(pricing));
    } catch {
      pricing = clone(committedPricing);
      throw new Error("Could not save pricing. Check saved data, browser storage space and permissions; changes were not saved.");
    }
    committedPricing = clone(pricing);
    renderPricing();
  }

  const units = {
    mg: { dimension: "mass", factor: 0.001 },
    g: { dimension: "mass", factor: 1 },
    gram: { dimension: "mass", factor: 1 },
    grams: { dimension: "mass", factor: 1 },
    kg: { dimension: "mass", factor: 1000 },
    kilogram: { dimension: "mass", factor: 1000 },
    kilograms: { dimension: "mass", factor: 1000 },
    ml: { dimension: "volume", factor: 1 },
    l: { dimension: "volume", factor: 1000 },
    litre: { dimension: "volume", factor: 1000 },
    litres: { dimension: "volume", factor: 1000 },
    liter: { dimension: "volume", factor: 1000 },
    liters: { dimension: "volume", factor: 1000 },
    tsp: { dimension: "volume", factor: 5 },
    teaspoon: { dimension: "volume", factor: 5 },
    teaspoons: { dimension: "volume", factor: 5 },
    tbsp: { dimension: "volume", factor: 15 },
    tablespoon: { dimension: "volume", factor: 15 },
    tablespoons: { dimension: "volume", factor: 15 },
    cup: { dimension: "volume", factor: 240 },
    cups: { dimension: "volume", factor: 240 },
    item: { dimension: "count", factor: 1 },
    items: { dimension: "count", factor: 1 },
    each: { dimension: "count", factor: 1 },
    piece: { dimension: "count", factor: 1 },
    pieces: { dimension: "count", factor: 1 },
    unit: { dimension: "count", factor: 1 },
    units: { dimension: "count", factor: 1 },
    dozen: { dimension: "count", factor: 12 }
  };

  function unitInfo(value) {
    const normalized = key(value);
    if (!normalized) return { dimension: "count", factor: 1, raw: "" };
    return units[normalized] ? { ...units[normalized], raw: normalized } : { dimension: `raw:${normalized}`, factor: 1, raw: normalized };
  }

  function quoteCost(item, quote) {
    if (item.buyQuantity === null || item.buyQuantity === undefined) return null;
    const needed = Number(item.buyQuantity);
    const pack = Number(quote.packageQuantity);
    const price = Number(quote.price);
    if (!Number.isFinite(needed) || needed < 0 || !Number.isFinite(pack) || pack <= 0 || !Number.isFinite(price) || price < 0) return null;

    const neededUnit = unitInfo(item.unit);
    const packUnit = unitInfo(quote.packageUnit);
    if (neededUnit.dimension !== packUnit.dimension) return null;

    const requiredBase = needed * neededUnit.factor;
    const packageBase = pack * packUnit.factor;
    const packages = Math.max(1, Math.ceil((requiredBase - Number.EPSILON) / packageBase));
    return { packages, cost: roundMoney(packages * price) };
  }

  function isExpired(quote) {
    if (!quote.validUntil) return false;
    return quote.validUntil < dateKey(new Date());
  }

  function quoteMatchesLocation(quote) {
    if (!pricing.location || !quote.location) return true;
    return key(quote.location) === key(pricing.location);
  }

  function matchingQuotes(item) {
    let candidates = pricing.quotes.filter((quote) =>
      key(quote.ingredient) === key(item.name) &&
      !isExpired(quote) &&
      quoteMatchesLocation(quote)
    );
    if (!pricing.preferredStores.length) return candidates;
    const wanted = new Set(pricing.preferredStores.map(key));
    const preferred = candidates.filter((quote) => wanted.has(key(quote.store)));
    return preferred.length ? preferred : candidates;
  }

  function bestQuote(item) {
    return matchingQuotes(item)
      .map((quote) => ({ quote, purchase: quoteCost(item, quote) }))
      .filter((entry) => entry.purchase)
      .sort((a, b) => a.purchase.cost - b.purchase.cost || Number(a.quote.price) - Number(b.quote.price))[0] || null;
  }

  function formatCurrency(value) {
    const currency = clean(pricing.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency === UNKNOWN_CURRENCY) {
      return roundMoney(value).toFixed(2);
    }
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
    } catch {
      return `${currency} ${roundMoney(value).toFixed(2)}`;
    }
  }

  function pricedShoppingList() {
    const range = currentWeekRange();
    const items = buildShoppingList({ ...range, subtract_pantry: true });
    let total = 0;
    let pricedCount = 0;
    const pricedItems = items.map((item) => {
      const match = bestQuote(item);
      if (match) {
        total += match.purchase.cost;
        pricedCount += 1;
      }
      return {
        ...item,
        estimate: match ? {
          cost: match.purchase.cost,
          packages: match.purchase.packages,
          store: match.quote.store,
          packageQuantity: match.quote.packageQuantity,
          packageUnit: match.quote.packageUnit,
          packagePrice: match.quote.price,
          promotion: match.quote.promotion || "",
          validUntil: match.quote.validUntil || "",
          sourceUrl: match.quote.sourceUrl || "",
          updatedAt: match.quote.updatedAt || null
        } : null
      };
    });
    return {
      period: range,
      location: pricing.location,
      preferredStores: [...pricing.preferredStores],
      currency: pricing.currency,
      total: roundMoney(total),
      pricedCount,
      itemCount: items.length,
      complete: items.length > 0 && pricedCount === items.length,
      items: pricedItems
    };
  }

  function setShoppingProfile({ location = "", preferred_stores = [], currency = UNKNOWN_CURRENCY } = {}) {
    if (!Array.isArray(preferred_stores)) throw new Error("Preferred stores must be an array.");
    const nextCurrency = clean(currency).toUpperCase() || UNKNOWN_CURRENCY;
    if (!/^[A-Z]{3}$/.test(nextCurrency)) throw new Error("Currency must be a three-letter ISO 4217 code.");
    const nextStores = [...new Set(preferred_stores.map(clean).filter(Boolean))];
    // Existing quote amounts cannot be reinterpreted in a different currency.
    if (nextCurrency !== pricing.currency) pricing.quotes = [];
    pricing.location = clean(location);
    pricing.preferredStores = nextStores;
    pricing.currency = nextCurrency;
    persistPricing();
    return { location: pricing.location, preferredStores: [...pricing.preferredStores], currency: pricing.currency };
  }

  function savePriceQuotes({ quotes = [] } = {}) {
    if (!Array.isArray(quotes) || !quotes.length) throw new Error("quotes must contain at least one price quote.");
    const now = new Date().toISOString();
    if (pricing.currency === UNKNOWN_CURRENCY) throw new Error("Set the shopping currency before saving price quotes.");
    const prepared = quotes.map((input) => {
      const ingredient = requireText(input.ingredient, "Ingredient");
      const store = requireText(input.store, "Store");
      const packageQuantity = Number(input.package_quantity);
      const price = Number(input.price);
      if (!Number.isFinite(packageQuantity) || packageQuantity <= 0) throw new Error(`Invalid package quantity for ${ingredient}.`);
      if (!Number.isFinite(price) || price < 0) throw new Error(`Invalid price for ${ingredient}.`);
      const validUntil = clean(input.valid_until);
      if (validUntil) parseDateKey(validUntil);
      const sourceUrl = clean(input.source_url);
      if (sourceUrl) {
        let url;
        try { url = new URL(sourceUrl); } catch { throw new Error("Invalid price source URL."); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Price source URL must use HTTP or HTTPS without credentials.");
      }
      return {
        id: uid(),
        ingredient,
        packageQuantity,
        packageUnit: clean(input.package_unit),
        price: roundMoney(price),
        store,
        location: clean(input.location || pricing.location),
        promotion: clean(input.promotion),
        validUntil,
        sourceUrl,
        updatedAt: now
      };
    });
    for (const record of prepared) {
      const quoteKey = `${key(record.ingredient)}|${key(record.store)}|${record.packageQuantity}|${key(record.packageUnit)}|${key(record.location)}`;
      pricing.quotes = pricing.quotes.filter((quote) => `${key(quote.ingredient)}|${key(quote.store)}|${quote.packageQuantity}|${key(quote.packageUnit)}|${key(quote.location)}` !== quoteKey);
      pricing.quotes.push(record);
    }
    pricing.quotes = pricing.quotes.filter((quote) => !isExpired(quote));
    persistPricing();
    return pricedShoppingList();
  }

  function clearPriceQuotes() {
    const removed = pricing.quotes.length;
    pricing.quotes = [];
    persistPricing();
    return { removed };
  }

  function currentPromotions(items) {
    const wantedIngredients = new Set(items.map((item) => key(item.name)));
    const wantedStores = new Set(pricing.preferredStores.map(key));
    const seen = new Set();
    return pricing.quotes.filter((quote) => {
      if (!quote.promotion || isExpired(quote) || !quoteMatchesLocation(quote) || !wantedIngredients.has(key(quote.ingredient))) return false;
      if (wantedStores.size && !wantedStores.has(key(quote.store))) return false;
      const promoKey = `${key(quote.ingredient)}|${key(quote.store)}|${key(quote.promotion)}`;
      if (seen.has(promoKey)) return false;
      seen.add(promoKey);
      return true;
    });
  }

  function injectUI() {
    const panel = document.querySelector('[data-panel="shopping"]');
    const list = document.querySelector("#shoppingList");
    if (!panel || !list || document.querySelector("#shoppingPriceControls")) return;

    const style = document.createElement("style");
    style.textContent = `
      .shopping-price-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:8px;margin-bottom:10px;padding:12px;border:1px solid var(--border);border-radius:4px;background:var(--surface)}
      .shopping-price-controls input{min-width:0}
      .shopping-summary{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:58px;margin-bottom:10px;padding:10px 14px;border:1px solid var(--border);border-radius:4px;background:var(--surface)}
      .shopping-summary strong{font-family:Georgia,"Times New Roman",serif;font-size:1.15rem;font-weight:500}
      .shopping-summary small{display:block;margin-top:2px;color:var(--text-secondary);font-size:.72rem}
      .shopping-deals{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
      .shopping-deal{padding:5px 8px;border:1px solid var(--border);border-radius:3px;color:var(--text-secondary);font-size:.72rem}
      .shopping-deal strong{color:var(--text);font-weight:600}
      .price-estimate{text-align:right;font-size:.875rem;font-weight:650}
      .price-source{color:#c98b97!important}
      @media(max-width:720px){.shopping-price-controls{grid-template-columns:1fr 1fr}.shopping-price-controls .button{width:100%}.shopping-summary{align-items:flex-start;flex-direction:column}.price-estimate{text-align:left}}
      @media(max-width:480px){.shopping-price-controls{grid-template-columns:1fr}}
    `;
    document.head.append(style);

    const controls = document.createElement("form");
    controls.id = "shoppingPriceControls";
    controls.className = "shopping-price-controls";
    controls.innerHTML = `
      <label class="sr-only" for="shoppingLocation">Shopping location</label>
      <input id="shoppingLocation" placeholder="City or region (optional)" autocomplete="off" />
      <label class="sr-only" for="shoppingStores">Preferred stores</label>
      <input id="shoppingStores" placeholder="Preferred stores, comma separated" />
      <button class="button ghost" type="submit">Save location</button>
      <button id="copyPricingPrompt" class="button ghost" type="button">Price with agent</button>`;

    const summary = document.createElement("div");
    summary.id = "shoppingPriceSummary";
    summary.className = "shopping-summary";

    const deals = document.createElement("div");
    deals.id = "shoppingDeals";
    deals.className = "shopping-deals";

    list.before(controls);
    list.before(summary);
    list.before(deals);

    controls.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const location = document.querySelector("#shoppingLocation").value;
        setShoppingProfile({
          location,
          preferred_stores: document.querySelector("#shoppingStores").value.split(","),
          currency: key(location) === key(pricing.location) ? pricing.currency : UNKNOWN_CURRENCY
        });
        showToast("Shopping settings saved");
      } catch (error) { showToast(error.message); }
    });

    document.querySelector("#copyPricingPrompt").addEventListener("click", async () => {
      const prompt = "Using this page's WebMCP tools, read my shopping price context. Use my saved currency or ask me which currency to use, then set it with set_shopping_currency before saving quotes. Find current prices and relevant promotions for the ingredients on my shopping list near my saved location and preferred stores, save those price quotes back to the page, then tell me the estimated basket total and cheapest useful deals. Do not change my recipes or meal plan.";
      try {
        await navigator.clipboard.writeText(prompt);
        showToast("Pricing prompt copied");
      } catch {
        showToast("Ask your agent to price the current shopping list");
      }
    });
  }

  const originalRenderShopping = renderShopping;
  renderShopping = function renderShoppingWithPrices() {
    originalRenderShopping();
    renderPricing();
  };

  function renderPricing() {
    if (!document.querySelector("#shoppingPriceControls")) return;
    document.querySelector("#shoppingLocation").value = pricing.location;
    document.querySelector("#shoppingStores").value = pricing.preferredStores.join(", ");

    const result = pricedShoppingList();
    const rows = [...document.querySelectorAll("#shoppingList .list-row")];
    rows.forEach((row, index) => {
      const item = result.items[index];
      if (!item) return;
      const estimateCell = row.children[2];
      if (estimateCell) {
        estimateCell.className = "price-estimate";
        estimateCell.textContent = item.estimate ? formatCurrency(item.estimate.cost) : "—";
      }
      row.querySelectorAll(".price-source").forEach((node) => node.remove());
      if (item.estimate) {
        const details = row.children[0];
        const source = document.createElement("small");
        source.className = "price-source";
        const promo = item.estimate.promotion ? ` · ${item.estimate.promotion}` : "";
        source.textContent = `${item.estimate.store}${promo}`;
        details.append(source);
      }
    });

    const summary = document.querySelector("#shoppingPriceSummary");
    if (pricingLoadFailed) {
      summary.textContent = "Saved pricing could not be read. Existing storage was preserved.";
    } else if (!result.itemCount) {
      const planned = getMealPlan(currentWeekRange()).length > 0;
      summary.innerHTML = `<div><strong>${planned ? "No purchases" : "No meals planned"}</strong><small>${planned ? "Your planned meals do not require anything beyond the pantry." : "Add meals to the selected week to build a shopping list."}</small></div>`;
    } else if (!result.pricedCount) {
      summary.innerHTML = `<div><strong>Estimated total —</strong><small>No saved prices yet. Ask your agent to price the list.</small></div>`;
    } else {
      const coverage = result.complete ? `${result.itemCount} items priced` : `${result.pricedCount} of ${result.itemCount} items priced`;
      summary.innerHTML = `<div><strong>${result.complete ? "Estimated total" : "Partial estimate"}</strong><small>${escapeHtml(coverage)}</small></div><strong>${escapeHtml(formatCurrency(result.total))}</strong>`;
    }

    const deals = document.querySelector("#shoppingDeals");
    const promotions = currentPromotions(result.items);
    deals.innerHTML = promotions.map((quote) => `<span class="shopping-deal"><strong>${escapeHtml(quote.ingredient)}</strong> · ${escapeHtml(quote.store)} · ${escapeHtml(quote.promotion)}</span>`).join("");
    deals.hidden = promotions.length === 0;
  }

  function priceContext() {
    const result = pricedShoppingList();
    return {
      location: pricing.location,
      preferredStores: [...pricing.preferredStores],
      currency: pricing.currency,
      period: result.period,
      shoppingList: result.items.map((item) => ({
        name: item.name,
        unit: item.unit,
        buyQuantity: item.buyQuantity,
        recipes: item.recipes,
        currentEstimate: item.estimate
      })),
      savedQuotes: pricing.quotes.filter((quote) => !isExpired(quote) && quoteMatchesLocation(quote))
    };
  }

  async function registerPricingTools() {
    if (!document.modelContext?.registerTool) return;
    const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
    const string = (description) => ({ type: "string", description });
    const number = (description, minimum = undefined) => ({ type: "number", description, ...(minimum === undefined ? {} : { minimum }) });

    const tools = [
      {
        name: "shopping_price_context",
        description: "Read the user's explicitly saved shopping location, preferred stores, current shopping-list quantities, existing price estimates and saved unexpired price quotes. Use this before researching grocery prices or promotions.",
        inputSchema: object({}),
        execute: () => toolText(priceContext(), "Shopping price context loaded.")
      },
      {
        name: "set_shopping_profile",
        description: "Save the location and preferred stores that the user explicitly wants used for grocery pricing. This is optional and stored only in this browser.",
        inputSchema: object({
          location: string("User-provided city, suburb, region or country; empty string clears it"),
          preferred_stores: { type: "array", items: { type: "string" }, description: "Optional retailer names the user prefers" },
          currency: string("Three-letter ISO 4217 currency code")
        }, ["location", "preferred_stores", "currency"]),
        execute: (input) => toolText(setShoppingProfile(input), "Shopping profile saved.")
      },
      {
        name: "save_price_quotes",
        description: "Save current grocery price quotes or promotions for shopping-list ingredients after researching the user's chosen location. Package size is required so the page can estimate actual packages that must be purchased rather than only ingredient consumption cost.",
        inputSchema: object({
          quotes: {
            type: "array",
            minItems: 1,
            items: object({
              ingredient: string("Ingredient name exactly as it appears in the shopping list when possible"),
              package_quantity: number("Amount contained in one purchasable package", 0.000001),
              package_unit: string("Package unit such as g, kg, ml, l, item, each or an empty string"),
              price: number("Current price for one package in the shopping profile currency", 0),
              store: string("Retailer or store name"),
              location: string("Location the quote applies to; normally the saved shopping location"),
              promotion: string("Optional promotion text; empty string when not promotional"),
              valid_until: string("Optional YYYY-MM-DD promotion/quote expiry date; empty string when unknown"),
              source_url: string("Optional source URL for traceability")
            }, ["ingredient", "package_quantity", "package_unit", "price", "store", "location", "promotion", "valid_until", "source_url"])
          }
        }, ["quotes"]),
        execute: (input) => toolText(savePriceQuotes(input), `${input.quotes.length} price quotes saved.`)
      },
      {
        name: "priced_shopping_list",
        description: "Return the current shopping list with package-aware estimated purchase cost per ingredient, store/deal details, coverage and estimated basket total using saved unexpired quotes.",
        inputSchema: object({}),
        execute: () => toolText(pricedShoppingList(), "Priced shopping list calculated.")
      },
      {
        name: "clear_price_quotes",
        description: "Clear saved grocery prices and promotions without changing the user's recipes, pantry, meal plan or shopping location.",
        inputSchema: object({}),
        execute: () => toolText(clearPriceQuotes(), "Saved price quotes cleared.")
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
        console.error(`WebMCP pricing tool registration failed for ${tool.name}`, error);
      }
    }

  }

  injectUI();
  renderPricing();
  registerPricingTools();

  globalThis.mealPlannerPricing = {
    getContext: priceContext,
    getPricedShoppingList: pricedShoppingList,
    setProfile: setShoppingProfile,
    saveQuotes: savePriceQuotes,
    clearQuotes: clearPriceQuotes
  };
})();