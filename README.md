# Meal Planner

Static meal-planning application with a WebMCP interface.

Live application: https://meal-planner-llai.onrender.com/

The application stores recipes, pantry inventory, dated meal plans and optional shopping-price data in browser localStorage. It derives shopping quantities and package-aware estimated purchase costs from the stored records. The human interface and WebMCP tools call the same functions and modify the same browser-local state.

## Functional scope

| Area | Stored or calculated data |
| --- | --- |
| Recipes | Name, base servings, preparation time, cooking time, tags, ingredients and ordered instructions |
| Ingredients | Name, numeric quantity or unquantified value, and unit |
| Meal plans | Date, breakfast/lunch/dinner slot, recipe reference and serving count |
| History | Meal-plan records remain queryable by date range |
| Pantry | Ingredient name, quantity and unit |
| Shopping list | Required quantity, pantry quantity used, remaining quantity and contributing recipes |
| Shopping profile | Optional user-supplied location, preferred stores and currency |
| Price quotes | Ingredient, package size, store, price, location, promotion, expiry and optional source URL |
| Shopping estimate | Package-aware estimated cost per item, priced-item coverage and basket total |
| Export | Complete core meal-planning state snapshot as JSON |
| Import | Validated version 1 snapshot restoring recipes, meal-plan history and pantry |

Recipe quantities are scaled by planned servings. Shopping calculations group ingredients by normalized name and unit, sum the scaled requirements, and optionally subtract matching pantry stock. Core recipe and pantry calculations do not attempt arbitrary ingredient-unit conversion.

The optional pricing layer converts common mass, volume and count units when comparing required quantities with purchasable package sizes. It estimates the number of whole packages that must actually be bought. For example, a 600 g requirement priced from a 500 g package is costed as two packages, not 1.2 packages.

Deleting a recipe also removes meal-plan entries that reference it. Setting a pantry quantity to zero removes that pantry record.

## WebMCP implementation

The application registers 20 tools with document.modelContext.registerTool():

| Tool | Operation |
| --- | --- |
| meal_context | Return recipes, pantry inventory, planned meals and calculated shopping items for a date range |
| list_recipes | Filter recipes by text, tags and maximum total cooking time |
| get_recipe | Return one complete recipe and optionally scale its ingredient quantities |
| save_recipe | Create or update a structured recipe |
| delete_recipe | Delete a recipe and its dependent planned meals |
| get_meal_plan | Return planned meals for a date range |
| plan_meal | Create or replace one dated meal slot |
| plan_meals | Create or replace multiple meal slots in one call |
| remove_meal | Remove one dated meal slot |
| list_pantry | Return current pantry inventory |
| set_pantry_item | Create, replace or remove a pantry quantity |
| build_shopping_list | Calculate shopping quantities for a date range |
| export_meal_data | Return the complete stored meal-planning state |
| import_meal_data | Validate and replace core meal-planning state from a version 1 export snapshot |
| shopping_price_context | Return the saved shopping location, preferred stores, current shopping requirements and existing current price quotes |
| set_shopping_profile | Save or clear the user-supplied shopping location and preferred stores |
| set_shopping_currency | Set the ISO 4217 currency inferred by the agent from the user's saved shopping location |
| save_price_quotes | Save researched package prices and relevant promotions for shopping-list ingredients |
| priced_shopping_list | Return package-aware item estimates, store/deal details, coverage and estimated basket total |
| clear_price_quotes | Clear saved prices and promotions without changing recipes, pantry, meal plan or shopping location |

Each tool defines a JSON input schema, validates input through the application functions, returns structured JSON-safe data and updates the visible page after a mutation.

There is no separate MCP server. Tool registration and execution happen in the page.

## State flow

1. A UI event or WebMCP tool calls an application function.
2. The function validates and normalizes the input.
3. The function reads or modifies browser-local state.
4. Mutations write versioned state to localStorage.
5. The planner, recipe list, pantry, shopping list and price estimates rerender from that state.

Storage keys:

- `meal-planner.webmcp.v1` — recipes, meal plans and pantry
- `meal-planner.shopping-pricing.v1` — optional shopping profile and price quotes

No account, backend service or database is required. State is specific to the browser profile and site origin. The Export action creates a portable JSON snapshot of the core meal-planning state. Import validates that snapshot before replacing recipes, plans and pantry; shopping location and saved price quotes are left unchanged.

## Agent workflow

Meal-planning request:

> Plan four dinners from my saved recipes, use what is already in my pantry, avoid repeating last week, then build my shopping list.

Expected tool sequence:

1. `meal_context` reads the current recipes, pantry, current plan and relevant history.
2. `list_recipes` or `get_recipe` retrieves additional recipe detail when required.
3. The agent presents or selects a plan.
4. `plan_meals` writes the approved meal slots.
5. `build_shopping_list` returns scaled requirements after pantry subtraction.
6. The same changes are immediately visible in the human interface.

Optional shopping-price request:

> Price my current shopping list using my saved location and preferred stores. Find current prices and relevant promotions, save the quotes, then give me the estimated basket total.

Expected tool sequence:

1. `shopping_price_context` reads the user's explicit location/store preferences and current ingredient requirements.
2. The agent determines the correct local ISO 4217 currency from that saved location and writes it with `set_shopping_currency`.
3. The agent researches current prices or promotions using whatever external sources are available to it in that market.
4. `save_price_quotes` writes structured package prices and promotion metadata back to the page.
5. `priced_shopping_list` calculates whole-package purchase costs and the basket total in the resolved local currency.
6. The Shopping view shows quantities, per-item estimates, retailer/deal information and estimate coverage.

When the user changes the saved shopping location, the currency is marked unresolved until the agent resolves it again. The application does not use device geolocation and does not assume a country from the browser.

This division is intentional:

- The user supplies preferences and explicitly chooses whether to store a shopping location.
- The agent handles selection, market/currency resolution, research and multi-step orchestration.
- The website owns persistence, validation, state mutation, quantity calculations and package-aware cost calculations.
- No third-party grocery API key is embedded in the static frontend.

## Interface

The interface provides four views:

- Weekly plan
- Recipes
- Pantry
- Shopping

Recipes have separate read-only viewing and editing flows.

The Shopping view keeps the calculated quantity visible and adds an optional estimated purchase cost. A user can save a city/region and preferred retailers manually. Relevant saved promotions for current shopping-list ingredients are shown without creating a general advertising feed.

The header reports the actual number of WebMCP tools currently discoverable through `document.modelContext.getTools()`. Agent Prompt copies the meal-planning example request. Import and Export provide a portable round-trip for core meal data. The Shopping view includes a Price with agent action that copies a pricing-specific agent request.

The interface remains usable without WebMCP. Agent tools require ChatGPT's in-app browser or a WebMCP-enabled Chrome build.

## Price data

Price data is deliberately provider-agnostic. The page does not contain retailer credentials or a hard-coded grocery data provider. Price quotes are structured records written by the user or an agent and include location and freshness metadata where available.

This keeps the deployed application static while allowing an agent to use current regional data sources when available. Expired promotion quotes are ignored automatically, and quotes from a different explicitly saved location are not used in the active estimate.

## Run locally

No package installation or build step is required.

~~~bash
python -m http.server 8080
~~~

Open http://localhost:8080/.

## Deployment

The project is a static site. Serve the repository root over HTTPS.

Render configuration is included in render.yaml. Netlify configuration is included in netlify.toml.

## Repository structure

| File | Purpose |
| --- | --- |
| index.html | Application markup and controls |
| styles.css | Responsive interface styles |
| app.js | Core state model, calculations, UI logic and WebMCP tools |
| webmcp-status.js | Counts discoverable WebMCP tools through the browser API and keeps the status badge accurate |
| import-data.js | Validated JSON import UI and `import_meal_data` WebMCP tool |
| recipe-view.js | Read-only recipe-view behavior and localization-helper loader |
| recipe-view.css | Read-only recipe-view styling |
| shopping-pricing.js | Optional location profile, price quotes, package-aware basket estimates, promotions and pricing WebMCP tools |
| shopping-localization.js | Agent-resolved local currency behavior and WebMCP currency tool |
| favicon.svg | Site icon |
| thumbnail.svg | Devpost/project thumbnail based on the site icon |
| render.yaml | Render static-site configuration |
| netlify.toml | Netlify static-site configuration |

## License

MIT