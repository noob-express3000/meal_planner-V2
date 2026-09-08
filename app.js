const STORAGE_KEY = "meal-planner.webmcp.v1";
const MEAL_TYPES = ["breakfast", "lunch", "dinner"];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

function freshState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    recipes: [],
    plans: [],
    pantry: [],
    createdAt: now,
    updatedAt: now
  };
}

let stateLoadFailed = false;
let committedState;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    return mealPlannerImport.validate(JSON.parse(raw));
  } catch {
    stateLoadFailed = true;
    return freshState();
  }
}

let state = freshState();
committedState = clone(state);
let visibleWeek = mondayOf(new Date());

function persist() {
  state.updatedAt = new Date().toISOString();
  try {
    if (stateLoadFailed) throw new Error("Unreadable saved data");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    state = clone(committedState);
    renderAll();
    throw new Error(stateLoadFailed
      ? "Saved meal data could not be read. Import a valid backup to replace it."
      : "Could not save meal data. Check browser storage space and permissions; changes were not saved.");
  }
  committedState = clone(state);
  renderAll();
  document.dispatchEvent(new Event("mealstatechange"));
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLocaleLowerCase().replace(/\s+/g, " ");
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireText(value, label) {
  const text = normalizeText(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function mondayOf(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function dateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date must use YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (dateKey(date) !== value) throw new Error("Date must be a valid calendar date.");
  return date;
}

function formatDate(value, options) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function recipeById(id) {
  return state.recipes.find((recipe) => recipe.id === id) || null;
}

function mealBySlot(date, mealType) {
  return state.plans.find((meal) => meal.date === date && meal.mealType === mealType) || null;
}

function cleanIngredient(input) {
  const name = requireText(input?.name, "Ingredient name");
  const raw = input?.quantity;
  const quantity = numberOrNull(raw);
  if (raw !== null && raw !== undefined && raw !== "" && quantity === null) throw new Error("Ingredient quantity must be a finite number or blank.");
  if (quantity !== null && quantity < 0) throw new Error(`Ingredient quantity cannot be negative: ${name}`);
  return { name, quantity, unit: normalizeText(input?.unit) };
}

function saveRecipe(input) {
  const name = requireText(input.name, "Recipe name");
  const servings = Number(input.servings);
  if (!Number.isFinite(servings) || servings <= 0) throw new Error("Servings must be greater than zero.");
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) throw new Error("At least one ingredient is required.");
  if (!Array.isArray(input.instructions) || input.instructions.length === 0) throw new Error("At least one instruction is required.");

  const existing = input.id ? recipeById(input.id) : null;
  if (input.id && !existing) throw new Error("Recipe not found.");
  if (input.tags !== undefined && !Array.isArray(input.tags)) throw new Error("Tags must be an array.");
  const instructions = input.instructions.map(normalizeText).filter(Boolean);
  if (!instructions.length) throw new Error("At least one non-empty instruction is required.");
  const prepMinutes = Number(input.prepMinutes ?? 0);
  const cookMinutes = Number(input.cookMinutes ?? 0);
  if (![prepMinutes, cookMinutes].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("Cooking times must be finite and non-negative.");
  const now = new Date().toISOString();
  const recipe = {
    id: existing?.id || uid(),
    name,
    servings,
    prepMinutes,
    cookMinutes,
    tags: [...new Set((input.tags || []).map(normalizeText).filter(Boolean))],
    ingredients: input.ingredients.map(cleanIngredient),
    instructions,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  if (existing) state.recipes = state.recipes.map((item) => item.id === recipe.id ? recipe : item);
  else state.recipes.push(recipe);
  persist();
  return clone(recipe);
}

function deleteRecipe(recipeId) {
  const recipe = recipeById(recipeId);
  if (!recipe) throw new Error("Recipe not found.");
  state.recipes = state.recipes.filter((item) => item.id !== recipeId);
  state.plans = state.plans.filter((meal) => meal.recipeId !== recipeId);
  persist();
  return { deletedRecipeId: recipeId, removedFromMealPlan: true };
}

function listRecipes({ query = "", tags = [], max_total_minutes = null } = {}) {
  const q = normalizeKey(query);
  const wantedTags = (tags || []).map(normalizeKey).filter(Boolean);
  const maxMinutes = numberOrNull(max_total_minutes);
  return clone(state.recipes.filter((recipe) => {
    const haystack = normalizeKey([recipe.name, ...recipe.tags, ...recipe.ingredients.map((item) => item.name)].join(" "));
    const tagSet = new Set(recipe.tags.map(normalizeKey));
    const total = recipe.prepMinutes + recipe.cookMinutes;
    return (!q || haystack.includes(q)) &&
      (!wantedTags.length || wantedTags.every((tag) => tagSet.has(tag))) &&
      (maxMinutes === null || total <= maxMinutes);
  }));
}

function getRecipe(recipeId, servings = null) {
  const recipe = recipeById(recipeId);
  if (!recipe) throw new Error("Recipe not found.");
  const targetServings = servings === null ? recipe.servings : Number(servings);
  if (!Number.isFinite(targetServings) || targetServings <= 0) throw new Error("Servings must be greater than zero.");
  const factor = targetServings / recipe.servings;
  return clone({
    ...recipe,
    servings: targetServings,
    ingredients: recipe.ingredients.map((item) => ({
      ...item,
      quantity: item.quantity === null ? null : roundQuantity(item.quantity * factor)
    }))
  });
}

function planMeal({ date, meal_type, recipe_id, servings }) {
  parseDateKey(date);
  if (!MEAL_TYPES.includes(meal_type)) throw new Error(`meal_type must be one of: ${MEAL_TYPES.join(", ")}.`);
  const recipe = recipeById(recipe_id);
  if (!recipe) throw new Error("Recipe not found.");
  const count = Number(servings ?? recipe.servings);
  if (!Number.isFinite(count) || count <= 0) throw new Error("Servings must be greater than zero.");
  const existing = mealBySlot(date, meal_type);
  const meal = {
    id: existing?.id || uid(),
    date,
    mealType: meal_type,
    recipeId: recipe_id,
    servings: count,
    updatedAt: new Date().toISOString()
  };
  if (existing) state.plans = state.plans.map((item) => item.id === existing.id ? meal : item);
  else state.plans.push(meal);
  persist();
  return enrichMeal(meal);
}

function planWeek(meals) {
  if (!Array.isArray(meals) || meals.length === 0) throw new Error("meals must contain at least one meal.");
  const seen = new Set();
  const prepared = meals.map((meal) => {
    parseDateKey(meal.date);
    if (!MEAL_TYPES.includes(meal.meal_type)) throw new Error(`Invalid meal type for ${meal.date}.`);
    if (!recipeById(meal.recipe_id)) throw new Error(`Recipe not found: ${meal.recipe_id}`);
    const key = `${meal.date}:${meal.meal_type}`;
    if (seen.has(key)) throw new Error(`Duplicate meal slot: ${key}`);
    seen.add(key);
    const recipe = recipeById(meal.recipe_id);
    const servings = Number(meal.servings ?? recipe.servings);
    if (!Number.isFinite(servings) || servings <= 0) throw new Error(`Invalid servings for ${key}.`);
    return { ...meal, servings };
  });

  for (const meal of prepared) {
    const existing = mealBySlot(meal.date, meal.meal_type);
    const record = {
      id: existing?.id || uid(),
      date: meal.date,
      mealType: meal.meal_type,
      recipeId: meal.recipe_id,
      servings: meal.servings,
      updatedAt: new Date().toISOString()
    };
    if (existing) state.plans = state.plans.map((item) => item.id === existing.id ? record : item);
    else state.plans.push(record);
  }
  persist();
  return getMealPlan({ start_date: prepared.map((m) => m.date).sort()[0], end_date: prepared.map((m) => m.date).sort().at(-1) });
}

function removeMeal({ date, meal_type }) {
  parseDateKey(date);
  if (!MEAL_TYPES.includes(meal_type)) throw new Error("Invalid meal type.");
  const before = state.plans.length;
  state.plans = state.plans.filter((meal) => !(meal.date === date && meal.mealType === meal_type));
  persist();
  return { removed: state.plans.length < before, date, meal_type };
}

function enrichMeal(meal) {
  const recipe = recipeById(meal.recipeId);
  return clone({
    ...meal,
    recipe: recipe ? { id: recipe.id, name: recipe.name, baseServings: recipe.servings, prepMinutes: recipe.prepMinutes, cookMinutes: recipe.cookMinutes, tags: recipe.tags } : null
  });
}

function getMealPlan({ start_date, end_date }) {
  parseDateKey(start_date);
  parseDateKey(end_date);
  if (start_date > end_date) throw new Error("start_date must be before or equal to end_date.");
  return state.plans
    .filter((meal) => meal.date >= start_date && meal.date <= end_date)
    .sort((a, b) => a.date.localeCompare(b.date) || MEAL_TYPES.indexOf(a.mealType) - MEAL_TYPES.indexOf(b.mealType))
    .map(enrichMeal);
}

function setPantryItem({ name, quantity, unit = "" }) {
  const cleanName = requireText(name, "Ingredient name");
  const cleanUnit = normalizeText(unit);
  const count = Number(quantity);
  if (!Number.isFinite(count) || count < 0) throw new Error("Pantry quantity must be zero or greater.");
  const key = `${normalizeKey(cleanName)}|${normalizeKey(cleanUnit)}`;
  const existing = state.pantry.find((item) => item.key === key);
  if (count === 0) {
    state.pantry = state.pantry.filter((item) => item.key !== key);
    persist();
    return { removed: Boolean(existing), name: cleanName, unit: cleanUnit };
  }
  const item = { key, name: cleanName, quantity: count, unit: cleanUnit, updatedAt: new Date().toISOString() };
  if (existing) state.pantry = state.pantry.map((entry) => entry.key === key ? item : entry);
  else state.pantry.push(item);
  persist();
  return clone(item);
}

function listPantry() {
  return clone([...state.pantry].sort((a, b) => a.name.localeCompare(b.name)));
}

function roundQuantity(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildShoppingList({ start_date, end_date, subtract_pantry = true }) {
  const meals = getMealPlan({ start_date, end_date });
  const groups = new Map();
  for (const meal of meals) {
    const recipe = recipeById(meal.recipeId);
    if (!recipe) continue;
    const factor = meal.servings / recipe.servings;
    for (const ingredient of recipe.ingredients) {
      const nameKey = normalizeKey(ingredient.name);
      const unitKey = normalizeKey(ingredient.unit);
      const key = `${nameKey}|${unitKey}`;
      const current = groups.get(key) || {
        name: ingredient.name,
        unit: ingredient.unit,
        quantity: 0,
        unquantified: false,
        recipes: new Set()
      };
      if (ingredient.quantity === null) current.unquantified = true;
      else current.quantity += ingredient.quantity * factor;
      current.recipes.add(recipe.name);
      groups.set(key, current);
    }
  }

  const pantry = new Map(state.pantry.map((item) => [item.key, item]));
  return [...groups.entries()].map(([key, group]) => {
    const have = subtract_pantry ? (pantry.get(key)?.quantity || 0) : 0;
    const needed = group.unquantified ? null : Math.max(0, roundQuantity(group.quantity - have));
    return {
      name: group.name,
      unit: group.unit,
      requiredQuantity: group.unquantified ? null : roundQuantity(group.quantity),
      pantryQuantityUsed: group.unquantified ? null : roundQuantity(Math.min(group.quantity, have)),
      buyQuantity: needed,
      recipes: [...group.recipes]
    };
  }).filter((item) => item.buyQuantity === null || item.buyQuantity > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getMealContext({ start_date, end_date }) {
  return {
    period: { start_date, end_date },
    recipes: state.recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      servings: recipe.servings,
      totalMinutes: recipe.prepMinutes + recipe.cookMinutes,
      tags: recipe.tags,
      ingredients: recipe.ingredients.map((item) => item.name)
    })),
    pantry: listPantry(),
    mealPlan: getMealPlan({ start_date, end_date }),
    shoppingList: buildShoppingList({ start_date, end_date, subtract_pantry: true })
  };
}

function exportData() {
  if (stateLoadFailed) throw new Error("Saved meal data could not be read. Existing storage was preserved; no empty backup was exported.");
  return clone(state);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function renderAll() {
  renderPlanner();
  renderRecipes();
  renderPantry();
  renderShopping();
}

function renderPlanner() {
  const grid = $("#plannerGrid");
  const weekEnd = addDays(visibleWeek, 6);
  $("#weekTitle").textContent = `${formatDate(visibleWeek, { month: "short", day: "numeric" })} – ${formatDate(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`;
  const today = dateKey(new Date());
  grid.innerHTML = "";

  for (let i = 0; i < 7; i++) {
    const date = addDays(visibleWeek, i);
    const key = dateKey(date);
    const card = document.createElement("article");
    card.className = `day-card${key === today ? " today" : ""}`;
    card.innerHTML = `<div class="day-head"><span class="day-name">${formatDate(date, { weekday: "short" })}</span><span class="day-date">${formatDate(date, { month: "short", day: "numeric" })}</span></div>`;

    for (const mealType of MEAL_TYPES) {
      const meal = mealBySlot(key, mealType);
      const recipe = meal ? recipeById(meal.recipeId) : null;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "meal-slot";
      button.dataset.date = key;
      button.dataset.mealType = mealType;
      button.innerHTML = `<span class="meal-type">${mealType}</span>${recipe ? `<span class="meal-title">${escapeHtml(recipe.name)}</span><span class="meal-meta">${meal.servings} servings</span>` : `<span class="meal-empty">+ Add meal</span>`}`;
      button.addEventListener("click", () => openMealDialog(key, mealType));
      card.append(button);
    }
    grid.append(card);
  }
}

function renderRecipes() {
  const list = $("#recipeList");
  list.innerHTML = "";
  if (!state.recipes.length) {
    list.innerHTML = `<div class="empty-state"><strong>No recipes</strong></div>`;
    return;
  }

  for (const recipe of [...state.recipes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const card = document.createElement("article");
    card.className = "recipe-card";
    const total = recipe.prepMinutes + recipe.cookMinutes;
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(recipe.name)}</h3>
        <div class="recipe-meta"><span>${recipe.servings} servings</span><span>${total} min total</span><span>${recipe.ingredients.length} ingredients</span></div>
        <div class="tag-row">${recipe.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      </div>
      <div class="recipe-actions">
        <button class="button ghost" type="button" data-edit>Edit</button>
        <button class="button ghost" type="button" data-delete>Delete</button>
      </div>`;
    $("[data-edit]", card).addEventListener("click", () => openRecipeDialog(recipe));
    $("[data-delete]", card).addEventListener("click", () => {
      if (confirm(`Delete “${recipe.name}”? Meals using it will also be removed from the plan.`)) {
        try {
          deleteRecipe(recipe.id);
          showToast("Recipe deleted");
        } catch (error) { showToast(error.message); }
      }
    });
    list.append(card);
  }
}

function renderPantry() {
  const list = $("#pantryList");
  const items = listPantry();
  list.innerHTML = items.length ? "" : `<div class="empty-state"><strong>Pantry empty</strong></div>`;
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `<div><strong>${escapeHtml(item.name)}</strong><small>Available</small></div><span class="quantity">${formatQuantity(item.quantity)} ${escapeHtml(item.unit)}</span><button class="text-button" type="button">Remove</button>`;
    $("button", row).addEventListener("click", () => {
      try { setPantryItem({ name: item.name, quantity: 0, unit: item.unit }); }
      catch (error) { showToast(error.message); }
    });
    list.append(row);
  }
}

function currentWeekRange() {
  return { start_date: dateKey(visibleWeek), end_date: dateKey(addDays(visibleWeek, 6)) };
}

function renderShopping() {
  const list = $("#shoppingList");
  const items = buildShoppingList({ ...currentWeekRange(), subtract_pantry: true });
  list.innerHTML = items.length ? "" : `<div class="empty-state"><strong>Shopping list empty</strong></div>`;
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list-row";
    const quantity = item.buyQuantity === null ? "as needed" : `${formatQuantity(item.buyQuantity)} ${item.unit}`.trim();
    row.innerHTML = `<div><strong>${escapeHtml(item.name)}</strong><small>For ${escapeHtml(item.recipes.join(", "))}</small></div><span class="quantity">${escapeHtml(quantity)}</span><span></span>`;
    list.append(row);
  }
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : String(roundQuantity(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function openRecipeDialog(recipe = null) {
  $("#recipeDialogTitle").textContent = recipe ? "Edit recipe" : "Add recipe";
  $("#recipeId").value = recipe?.id || "";
  $("#recipeName").value = recipe?.name || "";
  $("#recipeServings").value = recipe?.servings || 2;
  $("#recipePrep").value = recipe?.prepMinutes ?? 10;
  $("#recipeCook").value = recipe?.cookMinutes ?? 20;
  $("#recipeTags").value = recipe?.tags?.join(", ") || "";
  $("#recipeIngredients").value = recipe?.ingredients?.map((item) => `${item.quantity ?? ""} | ${item.unit} | ${item.name}`).join("\n") || "";
  $("#recipeInstructions").value = recipe?.instructions?.join("\n") || "";
  $("#recipeDialog").showModal();
}

function parseIngredientLines(value) {
  return String(value).split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 3) throw new Error(`Ingredient line must be “quantity | unit | ingredient”: ${line}`);
    return cleanIngredient({ quantity: parts[0], unit: parts[1], name: parts.slice(2).join("|").trim() });
  });
}

function openMealDialog(date, mealType) {
  const meal = mealBySlot(date, mealType);
  const select = $("#mealRecipe");
  select.innerHTML = state.recipes.length
    ? state.recipes.map((recipe) => `<option value="${escapeHtml(recipe.id)}">${escapeHtml(recipe.name)}</option>`).join("")
    : `<option value="">Add a recipe first</option>`;
  $("#mealDate").value = date;
  $("#mealType").value = mealType;
  $("#mealDialogTitle").textContent = `${mealType[0].toUpperCase() + mealType.slice(1)} · ${formatDate(parseDateKey(date), { weekday: "short", month: "short", day: "numeric" })}`;
  $("#mealRecipe").value = meal?.recipeId || state.recipes[0]?.id || "";
  $("#mealServings").value = meal?.servings || recipeById($("#mealRecipe").value)?.servings || 2;
  $("[data-remove-meal]").hidden = !meal;
  $("#mealDialog").showModal();
}

function bindUI() {
  const tabs = $$(".tab");
  const activate = (tab) => {
    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    $$("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab.dataset.tab));
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % tabs.length;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      activate(tabs[next]);
      tabs[next].focus();
    });
  });
  $(".brand").addEventListener("click", (event) => { event.preventDefault(); activate(tabs[0]); });
  activate(tabs[0]);

  $("#previousWeek").addEventListener("click", () => { visibleWeek = addDays(visibleWeek, -7); renderAll(); });
  $("#nextWeek").addEventListener("click", () => { visibleWeek = addDays(visibleWeek, 7); renderAll(); });
  $("#todayWeek").addEventListener("click", () => { visibleWeek = mondayOf(new Date()); renderAll(); });
  $("#addRecipeButton").addEventListener("click", () => openRecipeDialog());

  $("[data-copy-agent-prompt]")?.addEventListener("click", async () => {
    const prompt = "Use this page’s WebMCP tools to read my saved Profile and meal context. Plan four dinners that fit those preferences, use my pantry, save any missing recipes and supporting Sources, then build my shopping list. Ask me for missing constraints.";
    try {
      await navigator.clipboard.writeText(prompt);
      showToast("Agent prompt copied");
    } catch {
      showToast("Prompt available in the README");
    }
  });

  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

  $("#recipeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      saveRecipe({
        id: $("#recipeId").value || undefined,
        name: $("#recipeName").value,
        servings: Number($("#recipeServings").value),
        prepMinutes: Number($("#recipePrep").value),
        cookMinutes: Number($("#recipeCook").value),
        tags: $("#recipeTags").value.split(",").map((item) => item.trim()).filter(Boolean),
        ingredients: parseIngredientLines($("#recipeIngredients").value),
        instructions: $("#recipeInstructions").value.split("\n").map((item) => item.trim()).filter(Boolean)
      });
      $("#recipeDialog").close();
      showToast("Recipe saved");
    } catch (error) {
      alert(error.message);
    }
  });

  $("#mealRecipe").addEventListener("change", () => {
    const recipe = recipeById($("#mealRecipe").value);
    if (recipe) $("#mealServings").value = recipe.servings;
  });

  $("#mealForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      planMeal({
        date: $("#mealDate").value,
        meal_type: $("#mealType").value,
        recipe_id: $("#mealRecipe").value,
        servings: Number($("#mealServings").value)
      });
      $("#mealDialog").close();
      showToast("Meal planned");
    } catch (error) {
      alert(error.message);
    }
  });

  $("[data-remove-meal]").addEventListener("click", () => {
    try {
      removeMeal({ date: $("#mealDate").value, meal_type: $("#mealType").value });
      $("#mealDialog").close();
      showToast("Meal removed");
    } catch (error) { showToast(error.message); }
  });

  $("#pantryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      setPantryItem({ name: $("#pantryName").value, quantity: Number($("#pantryQuantity").value), unit: $("#pantryUnit").value });
      event.currentTarget.reset();
      showToast("Pantry updated");
    } catch (error) {
      alert(error.message);
    }
  });

  $("#copyShoppingButton").addEventListener("click", async () => {
    const items = buildShoppingList({ ...currentWeekRange(), subtract_pantry: true });
    const text = items.map((item) => `- ${item.name}: ${item.buyQuantity === null ? "as needed" : `${formatQuantity(item.buyQuantity)} ${item.unit}`.trim()}`).join("\n");
    try {
      await navigator.clipboard.writeText(text || "Nothing to buy.");
      showToast("Shopping list copied");
    } catch {
      showToast("Clipboard unavailable. You can select and copy the list directly.");
    }
  });

  $("#exportButton").addEventListener("click", () => {
    try {
      const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `meal-planner-${dateKey(new Date())}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Meal data exported");
    } catch (error) { showToast(error.message); }
  });
}

function toolText(data, message) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ ok: true, message, data })
    }]
  };
}

function toolFailure(error) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) }],
    isError: true
  };
}

async function registerWebMCP() {
  if (!document.modelContext?.registerTool) {
    return;
  }

  const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
  const string = (description) => ({ type: "string", description });
  const number = (description, minimum = undefined) => ({ type: "number", description, ...(minimum === undefined ? {} : { minimum }) });
  const boolean = (description) => ({ type: "boolean", description });
  const ingredientSchema = object({
    name: string("Ingredient name, e.g. chickpeas"),
    quantity: { type: ["number", "null"], description: "Numeric amount. Use null when the recipe says 'to taste' or otherwise gives no number." },
    unit: string("Unit such as g, ml, tbsp, tsp, cup, item, or an empty string when unitless")
  }, ["name", "quantity", "unit"]);

  const tools = [
    {
      name: "meal_context",
      description: "Read the user's structured meal-planning context for a date range in one call: saved recipe summaries, pantry inventory, planned meals, and the calculated shopping list. Use this before proposing or revising a meal plan so you respect what the user has already saved and planned.",
      inputSchema: object({ start_date: string("Start date in YYYY-MM-DD format"), end_date: string("End date in YYYY-MM-DD format") }, ["start_date", "end_date"]),
      execute: ({ start_date, end_date }) => toolText(getMealContext({ start_date, end_date }), "Meal-planning context loaded.")
    },
    {
      name: "list_recipes",
      description: "Find recipes in the user's saved recipe memory. Search matches recipe names, tags, and ingredient names. Use returned recipe IDs for planning meals or retrieving scaled ingredient quantities.",
      inputSchema: object({
        query: string("Optional text to match against recipe names, tags, and ingredients"),
        tags: { type: "array", items: { type: "string" }, description: "Optional tags that every returned recipe must have" },
        max_total_minutes: { type: ["number", "null"], minimum: 0, description: "Optional maximum prep plus cook time in minutes" }
      }),
      execute: (input) => toolText(listRecipes(input), "Recipes loaded.")
    },
    {
      name: "get_recipe",
      description: "Get one saved recipe with exact ingredients, quantities, units, instructions, times, tags, and timestamps. Optionally scale all numeric ingredient quantities to a different serving count.",
      inputSchema: object({ recipe_id: string("Saved recipe ID"), servings: { type: ["number", "null"], exclusiveMinimum: 0, description: "Optional target servings; null keeps the recipe's base servings" } }, ["recipe_id"]),
      execute: ({ recipe_id, servings = null }) => toolText(getRecipe(recipe_id, servings), "Recipe loaded.")
    },
    {
      name: "save_recipe",
      description: "Create or update a recipe in durable browser storage. Store structured servings, prep/cook time, ingredient quantities and units, tags, and ordered cooking instructions. Pass id only when updating an existing recipe.",
      inputSchema: object({
        id: string("Existing recipe ID when updating; omit for a new recipe"),
        name: string("Recipe name"),
        servings: number("Base number of servings", 0.01),
        prep_minutes: number("Preparation time in minutes", 0),
        cook_minutes: number("Cooking time in minutes", 0),
        tags: { type: "array", items: { type: "string" }, description: "Short descriptive tags such as quick, vegetarian, high-protein" },
        ingredients: { type: "array", minItems: 1, items: ingredientSchema, description: "Structured ingredients" },
        instructions: { type: "array", minItems: 1, items: { type: "string" }, description: "Cooking steps in order" }
      }, ["name", "servings", "ingredients", "instructions"]),
      execute: (input) => toolText(saveRecipe({ ...input, prepMinutes: input.prep_minutes, cookMinutes: input.cook_minutes }), "Recipe saved.")
    },
    {
      name: "delete_recipe",
      description: "Delete a saved recipe and remove any meal-plan entries that refer to it.",
      inputSchema: object({ recipe_id: string("Recipe ID to delete") }, ["recipe_id"]),
      execute: ({ recipe_id }) => toolText(deleteRecipe(recipe_id), "Recipe deleted.")
    },
    {
      name: "get_meal_plan",
      description: "Read planned breakfasts, lunches, and dinners in a date range. Results include recipe names, servings, tags, and cooking times, which makes prior weeks available as durable meal-plan history.",
      inputSchema: object({ start_date: string("Start date in YYYY-MM-DD format"), end_date: string("End date in YYYY-MM-DD format") }, ["start_date", "end_date"]),
      execute: (input) => toolText(getMealPlan(input), "Meal plan loaded.")
    },
    {
      name: "plan_meal",
      description: "Create or replace one meal-plan slot for a date. The website immediately updates and remembers the selection.",
      inputSchema: object({
        date: string("Meal date in YYYY-MM-DD format"),
        meal_type: { type: "string", enum: MEAL_TYPES, description: "Meal slot" },
        recipe_id: string("ID of a saved recipe"),
        servings: number("Servings to prepare", 0.01)
      }, ["date", "meal_type", "recipe_id", "servings"]),
      execute: (input) => toolText(planMeal(input), "Meal planned.")
    },
    {
      name: "plan_meals",
      description: "Plan or replace multiple meal slots in one validated update. Prefer this over many plan_meal calls when the user approves several meals at once.",
      inputSchema: object({
        meals: {
          type: "array",
          minItems: 1,
          items: object({
            date: string("Meal date in YYYY-MM-DD format"),
            meal_type: { type: "string", enum: MEAL_TYPES },
            recipe_id: string("ID of a saved recipe"),
            servings: number("Servings to prepare", 0.01)
          }, ["date", "meal_type", "recipe_id", "servings"])
        }
      }, ["meals"]),
      execute: ({ meals }) => toolText(planWeek(meals), `${meals.length} meals planned.`)
    },
    {
      name: "remove_meal",
      description: "Remove a breakfast, lunch, or dinner from a specific date while preserving all other meal-plan history.",
      inputSchema: object({ date: string("Meal date in YYYY-MM-DD format"), meal_type: { type: "string", enum: MEAL_TYPES } }, ["date", "meal_type"]),
      execute: (input) => toolText(removeMeal(input), "Meal removed.")
    },
    {
      name: "list_pantry",
      description: "Read the user's pantry inventory with exact quantities and units. Use it before shopping-list or use-what-I-have planning tasks.",
      inputSchema: object({}),
      execute: () => toolText(listPantry(), "Pantry loaded.")
    },
    {
      name: "set_pantry_item",
      description: "Create or replace the available quantity of a pantry ingredient. Set quantity to zero to remove the matching ingredient and unit from the pantry.",
      inputSchema: object({ name: string("Ingredient name"), quantity: number("Quantity currently available", 0), unit: string("Unit; use the same unit as recipes when possible") }, ["name", "quantity", "unit"]),
      execute: (input) => toolText(setPantryItem(input), "Pantry updated.")
    },
    {
      name: "build_shopping_list",
      description: "Calculate an exact shopping list from planned meals in a date range. Recipe quantities are scaled to planned servings, combined by normalized ingredient and unit, and can be reduced by matching pantry quantities.",
      inputSchema: object({
        start_date: string("Start date in YYYY-MM-DD format"),
        end_date: string("End date in YYYY-MM-DD format"),
        subtract_pantry: boolean("Whether to subtract matching pantry quantities; normally true")
      }, ["start_date", "end_date"]),
      execute: ({ start_date, end_date, subtract_pantry = true }) => toolText(buildShoppingList({ start_date, end_date, subtract_pantry }), "Shopping list calculated.")
    },
    {
      name: "export_meal_data",
      description: "Return a complete JSON-safe snapshot of the user's locally stored recipes, meal-plan history, pantry inventory, and timestamps for backup or agent-side analysis.",
      inputSchema: object({}),
      execute: () => toolText(exportData(), "Meal data exported.")
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

document.addEventListener("DOMContentLoaded", () => {
  state = loadState();
  committedState = clone(state);
  bindUI();
  renderAll();
  document.dispatchEvent(new Event("mealstatechange"));
  registerWebMCP();
  if (stateLoadFailed) showToast("Saved meal data could not be read. Import a valid backup; existing storage was preserved.");
});
