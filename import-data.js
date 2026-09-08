(() => {
  function assertObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  }

  function assertString(value, label, allowEmpty = false) {
    if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`${label} must be a ${allowEmpty ? "string" : "non-empty string"}.`);
    return value.trim();
  }

  function assertNumber(value, label, minimum = 0, allowNull = false) {
    if (allowNull && value === null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum) throw new Error(`${label} must be ${minimum > 0 ? `at least ${minimum}` : "zero or greater"}.`);
    return number;
  }

  function validateImportData(input) {
    assertObject(input, "Import data");
    if (input.version !== 1) throw new Error("Unsupported meal data version. Expected version 1.");
    if (!Array.isArray(input.recipes) || !Array.isArray(input.plans) || !Array.isArray(input.pantry)) {
      throw new Error("Import data must contain recipes, plans and pantry arrays.");
    }

    const recipeIds = new Set();
    const recipes = input.recipes.map((recipe, index) => {
      assertObject(recipe, `Recipe ${index + 1}`);
      const id = assertString(recipe.id, `Recipe ${index + 1} id`);
      if (recipeIds.has(id)) throw new Error(`Duplicate recipe id: ${id}`);
      recipeIds.add(id);

      if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) throw new Error(`Recipe ${index + 1} must contain ingredients.`);
      if (!Array.isArray(recipe.instructions) || !recipe.instructions.length) throw new Error(`Recipe ${index + 1} must contain instructions.`);
      if (!Array.isArray(recipe.tags)) throw new Error(`Recipe ${index + 1} tags must be an array.`);

      return {
        id,
        name: assertString(recipe.name, `Recipe ${index + 1} name`),
        servings: assertNumber(recipe.servings, `Recipe ${index + 1} servings`, Number.EPSILON),
        prepMinutes: assertNumber(recipe.prepMinutes ?? 0, `Recipe ${index + 1} prep minutes`),
        cookMinutes: assertNumber(recipe.cookMinutes ?? 0, `Recipe ${index + 1} cook minutes`),
        tags: [...new Set(recipe.tags.map((tag, tagIndex) => assertString(tag, `Recipe ${index + 1} tag ${tagIndex + 1}`)))],
        ingredients: recipe.ingredients.map((ingredient, ingredientIndex) => {
          assertObject(ingredient, `Recipe ${index + 1} ingredient ${ingredientIndex + 1}`);
          return {
            name: assertString(ingredient.name, `Recipe ${index + 1} ingredient ${ingredientIndex + 1} name`),
            quantity: assertNumber(ingredient.quantity, `Recipe ${index + 1} ingredient ${ingredientIndex + 1} quantity`, 0, true),
            unit: assertString(ingredient.unit ?? "", `Recipe ${index + 1} ingredient ${ingredientIndex + 1} unit`, true)
          };
        }),
        instructions: recipe.instructions.map((step, stepIndex) => assertString(step, `Recipe ${index + 1} instruction ${stepIndex + 1}`)),
        createdAt: typeof recipe.createdAt === "string" ? recipe.createdAt : new Date().toISOString(),
        updatedAt: typeof recipe.updatedAt === "string" ? recipe.updatedAt : new Date().toISOString()
      };
    });

    const planIds = new Set();
    const slots = new Set();
    const plans = input.plans.map((meal, index) => {
      assertObject(meal, `Meal plan entry ${index + 1}`);
      const id = assertString(meal.id, `Meal plan entry ${index + 1} id`);
      if (planIds.has(id)) throw new Error(`Duplicate meal plan id: ${id}`);
      planIds.add(id);

      const date = assertString(meal.date, `Meal plan entry ${index + 1} date`);
      parseDateKey(date);
      const mealType = assertString(meal.mealType, `Meal plan entry ${index + 1} meal type`);
      if (!MEAL_TYPES.includes(mealType)) throw new Error(`Invalid meal type in meal plan entry ${index + 1}.`);
      const recipeId = assertString(meal.recipeId, `Meal plan entry ${index + 1} recipe id`);
      if (!recipeIds.has(recipeId)) throw new Error(`Meal plan entry ${index + 1} references a missing recipe.`);

      const slot = `${date}:${mealType}`;
      if (slots.has(slot)) throw new Error(`Duplicate meal slot: ${slot}`);
      slots.add(slot);

      return {
        id,
        date,
        mealType,
        recipeId,
        servings: assertNumber(meal.servings, `Meal plan entry ${index + 1} servings`, Number.EPSILON),
        updatedAt: typeof meal.updatedAt === "string" ? meal.updatedAt : new Date().toISOString()
      };
    });

    const pantryKeys = new Set();
    const pantry = input.pantry.map((item, index) => {
      assertObject(item, `Pantry item ${index + 1}`);
      const name = assertString(item.name, `Pantry item ${index + 1} name`);
      const unit = assertString(item.unit ?? "", `Pantry item ${index + 1} unit`, true);
      const normalizedKey = `${normalizeKey(name)}|${normalizeKey(unit)}`;
      if (pantryKeys.has(normalizedKey)) throw new Error(`Duplicate pantry item: ${name} ${unit}`.trim());
      pantryKeys.add(normalizedKey);
      return {
        key: normalizedKey,
        name,
        quantity: assertNumber(item.quantity, `Pantry item ${index + 1} quantity`),
        unit,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString()
      };
    });

    return {
      version: 1,
      recipes,
      plans,
      pantry,
      createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function importMealData(input) {
    const validated = validateImportData(input);
    state = validated;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    visibleWeek = mondayOf(new Date());
    renderAll();
    return {
      imported: true,
      recipes: state.recipes.length,
      plannedMeals: state.plans.length,
      pantryItems: state.pantry.length,
      updatedAt: state.updatedAt
    };
  }

  function installImportUI() {
    const exportButton = document.querySelector("#exportButton");
    if (!exportButton || document.querySelector("#importButton")) return;

    const input = document.createElement("input");
    input.id = "importMealDataFile";
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;

    const button = document.createElement("button");
    button.id = "importButton";
    button.className = "button ghost";
    button.type = "button";
    button.setAttribute("aria-label", "Import meal data");
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9m0 0 4 4m-4-4-4 4M5 5h14"/></svg><span>Import</span>`;

    exportButton.before(button);
    exportButton.parentElement.append(input);

    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const validated = validateImportData(parsed);
        const summary = `${validated.recipes.length} recipes, ${validated.plans.length} planned meals and ${validated.pantry.length} pantry items`;
        if (!confirm(`Import ${summary}? This replaces the current meal data.`)) return;
        importMealData(validated);
        showToast("Meal data imported");
      } catch (error) {
        alert(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        input.value = "";
      }
    });
  }

  async function registerImportTool() {
    if (!document.modelContext?.registerTool) return;
    try {
      await document.modelContext.registerTool({
        name: "import_meal_data",
        description: "Replace the current browser-local recipes, meal-plan history and pantry with a previously exported Meal Planner version 1 snapshot. Validate all recipe references, meal slots, quantities and pantry records before replacing state. Shopping location and saved price quotes are not changed.",
        inputSchema: {
          type: "object",
          properties: {
            data: {
              type: "object",
              description: "Complete object previously returned by export_meal_data",
              properties: {
                version: { type: "number", enum: [1] },
                recipes: { type: "array", items: { type: "object", additionalProperties: true } },
                plans: { type: "array", items: { type: "object", additionalProperties: true } },
                pantry: { type: "array", items: { type: "object", additionalProperties: true } },
                createdAt: { type: "string" },
                updatedAt: { type: "string" }
              },
              required: ["version", "recipes", "plans", "pantry"],
              additionalProperties: true
            }
          },
          required: ["data"],
          additionalProperties: false
        },
        execute: async ({ data } = {}) => {
          try {
            return toolText(importMealData(data), "Meal data imported.");
          } catch (error) {
            return toolFailure(error);
          }
        }
      });
    } catch (error) {
      console.error("WebMCP import tool registration failed", error);
    }
  }

  installImportUI();
  setTimeout(registerImportTool, 0);

  globalThis.mealPlannerImport = {
    validate: validateImportData,
    importData: importMealData
  };
})();
