(() => {
  const STORAGE_KEY = "meal-planner.preferences.v1";
  const $ = (selector, root = document) => root.querySelector(selector);

  const emptyPreferences = () => ({
    version: 1,
    householdSize: null,
    dietaryRestrictions: [],
    allergies: [],
    dislikes: [],
    budget: { amount: null, currency: "" },
    equipment: [],
    maxCookMinutes: null,
    goals: [],
    updatedAt: null
  });

  function list(value) {
    if (Array.isArray(value)) return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
    return [...new Set(String(value ?? "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
  }

  function numberOrNull(value, minimum = 0) {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`Value must be ${minimum} or greater.`);
    return parsed;
  }

  let preferencesLoadFailed = false;

  function loadPreferences() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed) return emptyPreferences();
      if (parsed.version !== 1) throw new Error("Invalid profile data");
      if (parsed?.version === 1) {
        const currency = String(parsed.budget?.currency ?? "").trim().toUpperCase();
        if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid currency");
        const householdSize = numberOrNull(parsed.householdSize, 1);
        if (householdSize !== null && !Number.isInteger(householdSize)) throw new Error("Invalid household size");
        return {
          ...emptyPreferences(),
          ...parsed,
          householdSize,
          maxCookMinutes: numberOrNull(parsed.maxCookMinutes),
          dietaryRestrictions: list(parsed.dietaryRestrictions),
          allergies: list(parsed.allergies),
          dislikes: list(parsed.dislikes),
          equipment: list(parsed.equipment),
          goals: list(parsed.goals),
          budget: {
            amount: numberOrNull(parsed.budget?.amount),
            currency: String(parsed.budget?.currency ?? "").trim().toUpperCase()
          }
        };
      }
    } catch { preferencesLoadFailed = true; }
    return emptyPreferences();
  }

  let preferences = loadPreferences();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function savePreferences(input = {}) {
    const next = clone(preferences);

    if (Object.hasOwn(input, "household_size")) next.householdSize = numberOrNull(input.household_size, 1);
    if (next.householdSize !== null && !Number.isInteger(next.householdSize)) throw new Error("Household size must be a whole number.");
    if (Object.hasOwn(input, "dietary_restrictions")) next.dietaryRestrictions = list(input.dietary_restrictions);
    if (Object.hasOwn(input, "allergies")) next.allergies = list(input.allergies);
    if (Object.hasOwn(input, "dislikes")) next.dislikes = list(input.dislikes);
    if (Object.hasOwn(input, "equipment")) next.equipment = list(input.equipment);
    if (Object.hasOwn(input, "max_cook_minutes")) next.maxCookMinutes = numberOrNull(input.max_cook_minutes, 0);
    if (Object.hasOwn(input, "goals")) next.goals = list(input.goals);

    if (Object.hasOwn(input, "budget_amount")) next.budget.amount = numberOrNull(input.budget_amount, 0);
    if (Object.hasOwn(input, "budget_currency")) {
      const currency = String(input.budget_currency ?? "").trim().toUpperCase();
      if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error("Budget currency must be a three-letter ISO 4217 code.");
      next.budget.currency = currency;
    }

    next.updatedAt = new Date().toISOString();
    try {
      if (preferencesLoadFailed) throw new Error("Unreadable profile");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { throw new Error("Could not save Profile. Check saved data, browser storage space and permissions; changes were not saved."); }
    preferences = next;
    renderPreferences();
    return clone(preferences);
  }

  function clearPreferences() {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch { throw new Error("Could not clear Profile. Check browser storage permissions."); }
    preferences = emptyPreferences();
    preferencesLoadFailed = false;
    renderPreferences();
    return clone(preferences);
  }

  function getPreferences() {
    return clone(preferences);
  }

  function formatList(items) {
    return items.join(", ");
  }

  function fillForm() {
    if (!$("#preferencesForm")) return;
    $("#prefHousehold").value = preferences.householdSize ?? "";
    $("#prefRestrictions").value = formatList(preferences.dietaryRestrictions);
    $("#prefAllergies").value = formatList(preferences.allergies);
    $("#prefDislikes").value = formatList(preferences.dislikes);
    $("#prefBudget").value = preferences.budget.amount ?? "";
    $("#prefCurrency").value = preferences.budget.currency || "";
    $("#prefEquipment").value = formatList(preferences.equipment);
    $("#prefMaxCook").value = preferences.maxCookMinutes ?? "";
    $("#prefGoals").value = formatList(preferences.goals);
  }

  function addSummaryItem(container, label, value) {
    if (!value) return;
    const item = document.createElement("div");
    item.className = "profile-summary-item";
    const key = document.createElement("span");
    key.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    item.append(key, content);
    container.append(item);
  }

  function renderPreferences() {
    fillForm();
    const summary = $("#preferenceSummary");
    if (!summary) return;
    summary.replaceChildren();

    addSummaryItem(summary, "Household", preferences.householdSize ? `${preferences.householdSize}` : "");
    addSummaryItem(summary, "Restrictions", formatList(preferences.dietaryRestrictions));
    addSummaryItem(summary, "Allergies", formatList(preferences.allergies));
    addSummaryItem(summary, "Avoid", formatList(preferences.dislikes));
    addSummaryItem(summary, "Budget", preferences.budget.amount !== null ? `${preferences.budget.currency || ""} ${preferences.budget.amount}`.trim() : "");
    addSummaryItem(summary, "Equipment", formatList(preferences.equipment));
    addSummaryItem(summary, "Cook time", preferences.maxCookMinutes !== null ? `${preferences.maxCookMinutes} min max` : "");
    addSummaryItem(summary, "Goals", formatList(preferences.goals));

    if (!summary.children.length) {
      const empty = document.createElement("div");
      empty.className = "profile-summary-empty";
      empty.textContent = preferencesLoadFailed ? "Saved Profile could not be read. Clear it to start again; existing storage was preserved." : "No planning constraints saved.";
      summary.append(empty);
    }
  }

  function bindUI() {
    const form = $("#preferencesForm");
    if (!form) return;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        savePreferences({
          household_size: $("#prefHousehold").value,
          dietary_restrictions: $("#prefRestrictions").value,
          allergies: $("#prefAllergies").value,
          dislikes: $("#prefDislikes").value,
          budget_amount: $("#prefBudget").value,
          budget_currency: $("#prefCurrency").value,
          equipment: $("#prefEquipment").value,
          max_cook_minutes: $("#prefMaxCook").value,
          goals: $("#prefGoals").value
        });
        globalThis.showToast?.("Planning profile saved");
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      }
    });

    $("#clearPreferences")?.addEventListener("click", () => {
      try {
        if (!confirm("Clear the saved planning profile?")) return;
        clearPreferences();
        showToast("Planning profile cleared");
      } catch (error) { showToast(error.message); }
    });
  }

  function toolResult(data, message) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, message, data }) }] };
  }

  function toolFailure(error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) }],
      isError: true
    };
  }

  async function registerTools() {
    if (!document.modelContext?.registerTool) return;
    const arrayOfStrings = (description) => ({ type: "array", items: { type: "string" }, description });

    const tools = [
      {
        name: "get_preferences",
        description: "Read the user's persistent meal-planning profile before proposing meals. Includes household size, dietary restrictions, allergies, dislikes, budget, cooking equipment, maximum cooking time and goals.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => toolResult(getPreferences(), "Planning preferences loaded.")
      },
      {
        name: "set_preferences",
        description: "Create or update persistent meal-planning constraints in browser-local storage. Only supplied fields are changed, so use this when the user states new household, dietary, allergy, budget, equipment, cooking-time or goal information.",
        inputSchema: {
          type: "object",
          properties: {
            household_size: { type: ["integer", "null"], minimum: 1, description: "Number of people normally being planned for" },
            dietary_restrictions: arrayOfStrings("Dietary rules such as vegetarian, halal or gluten-free"),
            allergies: arrayOfStrings("Food allergies that must be avoided"),
            dislikes: arrayOfStrings("Ingredients or foods the user prefers not to eat"),
            budget_amount: { type: ["number", "null"], minimum: 0, description: "Target weekly food budget amount" },
            budget_currency: { type: "string", description: "Three-letter ISO 4217 currency code" },
            equipment: arrayOfStrings("Available cooking equipment, e.g. stove, microwave, air fryer"),
            max_cook_minutes: { type: ["number", "null"], minimum: 0, description: "Maximum preferred total cooking time in minutes" },
            goals: arrayOfStrings("Meal-planning goals such as high-protein, weight gain, low cost or meal prep")
          },
          additionalProperties: false
        },
        execute: (input) => toolResult(savePreferences(input), "Planning preferences saved.")
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

  renderPreferences();
  bindUI();
  registerTools();

  globalThis.mealPlannerPreferences = { get: getPreferences, set: savePreferences, clear: clearPreferences };
})();