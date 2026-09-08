(() => {
  const dialog = document.createElement("dialog");
  dialog.id = "recipeViewDialog";
  dialog.innerHTML = `
    <div class="recipe-view-shell">
      <div class="dialog-head">
        <div>
          <h2 data-view-title>Recipe</h2>
          <div class="recipe-view-meta" data-view-meta></div>
        </div>
        <button class="icon-button" type="button" data-view-close aria-label="Close">×</button>
      </div>

      <div class="tag-row" data-view-tags></div>

      <section class="recipe-view-section">
        <h3>Ingredients</h3>
        <div class="recipe-view-ingredients" data-view-ingredients></div>
      </section>

      <section class="recipe-view-section">
        <h3>Instructions</h3>
        <ol class="recipe-view-instructions" data-view-instructions></ol>
      </section>

      <div class="dialog-actions">
        <button class="button ghost" type="button" data-view-close>Close</button>
        <button class="button primary" type="button" data-view-edit>Edit recipe</button>
      </div>
    </div>`;

  document.body.append(dialog);

  function ingredientAmount(item) {
    if (item.quantity === null) return item.unit || "as needed";
    return `${formatQuantity(item.quantity)} ${item.unit}`.trim();
  }

  function openRecipeView(recipe) {
    dialog.dataset.recipeId = recipe.id;
    $("[data-view-title]", dialog).textContent = recipe.name;

    const total = recipe.prepMinutes + recipe.cookMinutes;
    $("[data-view-meta]", dialog).innerHTML = [
      `${recipe.servings} servings`,
      `${recipe.prepMinutes} min prep`,
      `${recipe.cookMinutes} min cook`,
      `${total} min total`
    ].map((item) => `<span>${escapeHtml(item)}</span>`).join("");

    $("[data-view-tags]", dialog).innerHTML = recipe.tags.length
      ? recipe.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")
      : "";

    $("[data-view-ingredients]", dialog).innerHTML = recipe.ingredients.map((item) => `
      <div class="recipe-view-ingredient">
        <span>${escapeHtml(item.name)}</span>
        <strong>${escapeHtml(ingredientAmount(item))}</strong>
      </div>`).join("");

    $("[data-view-instructions]", dialog).innerHTML = recipe.instructions
      .map((step) => `<li>${escapeHtml(step)}</li>`)
      .join("");

    dialog.showModal();
  }

  $$('[data-view-close]', dialog).forEach((button) => button.addEventListener("click", () => dialog.close()));

  $("[data-view-edit]", dialog).addEventListener("click", () => {
    const recipe = recipeById(dialog.dataset.recipeId);
    if (!recipe) return;
    dialog.close();
    openRecipeDialog(recipe);
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  const baseRenderRecipes = renderRecipes;
  renderRecipes = function renderRecipesWithView() {
    baseRenderRecipes();

    const recipes = [...state.recipes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const cards = $$("#recipeList .recipe-card");

    cards.forEach((card, index) => {
      const recipe = recipes[index];
      const actions = $(".recipe-actions", card);
      if (!recipe || !actions) return;

      const button = document.createElement("button");
      button.className = "button ghost";
      button.type = "button";
      button.textContent = "View";
      button.addEventListener("click", () => openRecipeView(recipe));
      actions.prepend(button);
    });
  };

  renderRecipes();

  window.addEventListener("DOMContentLoaded", () => {
    const localizationScript = document.createElement("script");
    localizationScript.src = "./shopping-localization.js";
    document.head.append(localizationScript);
  }, { once: true });
})();