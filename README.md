# Meal Planner V2

Browser-based meal planning with a human interface and 25 WebMCP tools for compatible external agents.

[Open application](https://meal-planner-lfi2.onrender.com/)

## Features

| Feature | Behavior |
| --- | --- |
| Meal plan | Assign recipes to breakfast, lunch and dinner slots by date. Set servings per meal. |
| Recipes | Store ingredients, quantities, units, instructions, cooking times and tags. View recipes without editing. |
| Pantry | Record available ingredient quantities. Update stock or remove items. |
| Shopping | Scale recipe quantities to planned servings, combine matching ingredients and subtract pantry stock. |
| Sources | Save articles, videos and notes. Optionally associate a source with a recipe. |
| Profile | Save household size, dietary restrictions, allergies, dislikes, equipment, cooking-time limits, budget and goals. |
| Pricing | Store researched package quotes and calculate shopping estimates for the selected week. |
| Import / Export | Transfer recipes, meal plans and pantry records as JSON. Import replaces core data. |

## Meal planning and shopping

Each meal record refers to a saved recipe and specifies a date, meal slot and serving count. Editing a recipe changes the quantities used by meals referring to it. Deleting a recipe also removes its planned meals.

Shopping is calculated from the selected period rather than stored as a separate list:

1. Scale each recipe's ingredients by planned servings divided by base servings.
2. Combine ingredients with matching normalized names and units.
3. Subtract matching pantry quantities.
4. Omit fully covered ingredients and display the remaining quantities.

Example: 200 g of rice for two servings becomes 400 g for four servings. With 150 g in the pantry, Shopping shows 250 g to buy.

Matching ignores case and extra whitespace. It does not merge synonyms or convert pantry units such as kg to g. Unquantified ingredients remain "as needed". Numeric quantities round to two decimal places. Calculating a list does not reduce pantry inventory.

## Agent operation

The page registers tools through `document.modelContext.registerTool()`. Tool handlers call the same JavaScript operations used by the forms. Changes appear in the human interface.

The external agent performs recipe selection, research and multi-step planning. The application validates supported inputs, saves records and calculates quantities. It contains no built-in chatbot or model integration.

Agent access requires a compatible browser and external agent. The human interface works without WebMCP. Profile constraints provide planning context; the application does not enforce dietary suitability or certify allergy safety.

<details>
<summary>25 WebMCP tools</summary>

### Context and profile

- `meal_context`
- `get_preferences`
- `set_preferences`

### Recipes and planning

- `list_recipes`
- `get_recipe`
- `save_recipe`
- `delete_recipe`
- `get_meal_plan`
- `plan_meal`
- `plan_meals`
- `remove_meal`

### Pantry and shopping

- `list_pantry`
- `set_pantry_item`
- `build_shopping_list`
- `shopping_price_context`
- `set_shopping_profile`
- `set_shopping_currency`
- `save_price_quotes`
- `priced_shopping_list`
- `clear_price_quotes`

### Data portability

- `export_meal_data`
- `import_meal_data`

### Sources

- `list_sources`
- `save_source`
- `delete_source`

The status indicator counts this page’s discoverable tools when the browser provides `getTools()`. Otherwise it counts successful registrations and identifies that fallback in its tooltip. Failed registrations show a partial count. The expected complete surface is 25 tools, registered once each.

</details>

## Sources and pricing

Sources store a title, URL, type and optional note or recipe reference. Supported YouTube, Vimeo and direct video URLs can render in the Sources view. Playback depends on provider availability and embedding restrictions. External links and embeds contact their providers.

The site does not fetch or verify retailer prices. An external agent can research offers for a location explicitly supplied by the user and save quotes.

Pricing compares whole-package costs, converts supported package units, excludes expired quotes and reports partial coverage. Preferred stores take precedence when matching quotes exist. Promotions are notes; quotes must contain the effective single-package price. Estimates exclude delivery, tax adjustments and conditional multi-buy calculations.

Shopping currency is user-selected and separate from Profile budget currency. `XXX` means unset. Changing shopping currency clears quotes. Changing location through the human form also resets currency. No device geolocation is requested.

Package conversions support compatible mass, volume and count units. Cooking-volume conventions are 240 ml per cup, 15 ml per tablespoon and 5 ml per teaspoon. These conversions apply to pricing, not pantry subtraction.

## Data storage and backup

State is JSON in browser `localStorage`, scoped to the current browser profile and site address.

| Storage key | Contents | Exported |
| --- | --- | --- |
| `meal-planner.webmcp.v1` | Recipes, plans, pantry and timestamps | Yes |
| `meal-planner.preferences.v1` | Profile | No |
| `meal-planner.sources.v1` | Sources | No |
| `meal-planner.shopping-pricing.v1` | Shopping settings and quotes | No |

Export is not a full-workspace backup. Import validates and replaces core meal data without merging it or changing the other records. Sources may retain unresolved recipe references after a recipe deletion or import.

Failed writes preserve the last committed state and report an error. Unreadable records produce warnings rather than silent overwrites. Valid import can replace unreadable core data. Profile has a Clear action. Corrupt Sources or pricing require browser-storage recovery.

There is no automatic cross-device or cross-tab synchronization. Use one active tab. Clearing site data removes saved records. Changing browser profile or site address creates a separate workspace.

The app has no offline service worker, so local storage does not guarantee offline page loading. No application account, server database, analytics or application API key is required. Data returned to an external agent is subject to that agent's service and privacy behavior.

## Implementation

HTML, CSS and vanilla JavaScript. Static hosting serves the files; application logic runs in the browser.

| File | Responsibility |
| --- | --- |
| `index.html` | Tabs, forms, dialogs and script order |
| `app.js` | Core state, validation, meal operations, calculations, rendering and tools |
| `webmcp-status.js` | Shared tool registration and status |
| `preferences.js` | Profile storage, forms and tools |
| `sources.js` | Source records and media rendering |
| `shopping-pricing.js` | Quotes and package-cost calculation |
| `shopping-localization.js` | Shopping-currency tool |
| `import-data.js` | Core-state validation and replacement imports |
| `recipe-view.js` | Read-only recipe dialog |
| `styles.css`, `shell.css`, `sources.css`, `recipe-view.css` | Interface styling |

The status helper loads first, then core definitions and feature scripts. Core loading and initial rendering wait for `DOMContentLoaded`. Pricing extends the shopping renderer. Sources listens for `mealstatechange`. Shared functions and script order are implementation dependencies.

## Run locally

With Python installed, run from the repository root:

```bash
python -m http.server 8080
```

Open `http://localhost:8080/`. No build step is required.

## Tests

With Node.js installed:

```bash
node --test tests/*.test.cjs
```

CI checks script syntax, file references and application surfaces, then runs the regression suite. Tests load application scripts in HTML order using a minimal DOM/WebMCP adapter. Coverage includes registrations, state mutation, rollback, malformed storage, imports and pricing.

Layout, downloads, clipboard behavior, video playback and native WebMCP interoperability require real-browser checks.

## Deployment

Serve the repository root over HTTPS on a static host. Configuration is included in `render.yaml` and `netlify.toml`.

## Project history

The V2 competition repository began on September 8, 2026, from `noob-express3000/meal_planner`. The original repository remains separate.

## License

[MIT](LICENSE)
