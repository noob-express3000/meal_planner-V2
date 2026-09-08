# Meal Planner V2 — AI Builders 2026

Meal Planner V2 is a local-first meal-planning application that can be operated through the normal human interface or by a WebMCP-capable AI agent.

This repository is the **AI Builders 2026 competition version**. It was created from the earlier `noob-express3000/meal_planner` project on **2026-09-08**. The original repository remains separate; competition-specific development continues here in `noob-express3000/meal_planner-V2`.

## What it does

The website owns persistence, validation, state mutation and deterministic calculations. The agent handles reasoning, research, selection and multi-step orchestration.

There is no hosted model, account system, application API key or server database required for the core application.

The interface has six views:

- **Plan** — breakfast, lunch and dinner slots by date
- **Recipes** — structured servings, ingredients, cooking times and instructions
- **Pantry** — ingredients already available
- **Shopping** — requirements calculated from the plan after recipe scaling and pantry subtraction
- **Sources** — videos, articles and references retained by the human or agent
- **Profile** — reusable household constraints, budget, equipment and goals

## Agent workflow

Example objective:

> We are two people with a weekly grocery budget of 100 in my saved currency. Keep dinners high-protein, under 30 minutes and peanut-free. Use what is already in the pantry. Add any missing recipes, retain useful sources, plan the week and build the shopping list.

A WebMCP-capable agent can:

1. Read the planning profile and current meal context.
2. Preserve newly stated constraints.
3. Inspect recipes, prior plans and pantry inventory.
4. Select or research meals that satisfy those constraints.
5. Save missing recipes.
6. Save supporting videos or articles as Sources.
7. Write the meal plan.
8. Calculate the resulting shopping list.
9. Optionally research package prices and promotions for a user-supplied shopping region.

Every mutation is immediately visible in the same interface used by the human.

## Sources and provenance

Sources are persistent application state rather than transient links in a chat response.

Supported video sources can play directly in the Sources view:

- YouTube
- Vimeo
- direct MP4/WebM/OGG URLs

Other sources remain normal external links.

A source can optionally reference a saved recipe. This lets an agent leave behind the material used when researching or constructing a recipe.

## Planning profile

Profile state is stored locally and contains:

- household size
- dietary restrictions
- allergies
- disliked foods
- weekly budget and currency
- cooking equipment
- maximum cooking time
- planning goals

`set_preferences` performs partial updates, so adding one constraint does not replace unrelated profile state.

## WebMCP

The page registers structured tools with `document.modelContext.registerTool()` through the shared `registerMealTool` status helper. There is no separate MCP server. A compatible browser and external agent are required for agent operation; ordinary browsers retain the full human interface.

The current surface contains **25 tools**.

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

## Architecture

Human UI → deterministic browser-local state ← WebMCP tools ← external AI agent.

The application remains usable when WebMCP is unavailable. WebMCP exposes machine-operable access to the same state and functions rather than introducing a second application backend.

## Local state

State belongs to the current browser profile and site origin.

- `meal-planner.webmcp.v1` — recipes, meal plans and pantry
- `meal-planner.shopping-pricing.v1` — optional shopping region, preferred stores and saved price quotes
- `meal-planner.sources.v1` — videos, articles, references and recipe provenance
- `meal-planner.preferences.v1` — household constraints, budget, equipment and goals

Shopping location is optional and explicitly supplied by the user. The application does not request device geolocation or select a geographic currency default. The saved value is visible in its editable field and available to pricing tools, but is not added to status messages or shopping summaries.

Sources and Profile are separate from the core meal snapshot. **Export/import covers recipes, meal plans, pantry and timestamps only.** Import replaces that core state after validation; it does not back up, replace or clear Sources, Profile, shopping settings or price quotes. Recipe links in Sources can become unresolved after a recipe is deleted or a different core snapshot is imported; the source remains available.

Failed writes return an error and preserve the last committed state. Unreadable stored records display a warning and are not silently overwritten. A valid core import can replace unreadable meal data; Profile has an explicit Clear action. Corrupt Sources/pricing currently require recovery through browser storage tools.

Use one active tab during the demo: state is not synchronized between open tabs. Clearing site data, changing origin or using another browser profile does not retain the saved workspace. The app does not install an offline service worker.

External source links and supported embeds contact their providers and follow those providers’ availability and privacy behavior. No analytics, application API key or embedded model is included.

## Quick evaluation

For a demonstration under 60 seconds: show a saved Profile, ask the external agent to save one recipe and its Source, plan it for the selected week, then show the calculated Shopping list. Change a pantry quantity to demonstrate deterministic recalculation. Prepare the compatible browser/agent session beforehand; external research and video playback are network-dependent.

1. Serve the application over HTTPS or run it locally.
2. Open it in a browser environment with WebMCP/Site Tools support.
3. Confirm the WebMCP indicator reports the available tools.
4. Save a Profile with a few constraints.
5. Add or import recipes and pantry items.
6. Ask an agent to plan meals using the saved constraints and pantry.
7. Verify the resulting Plan, Shopping list and Sources directly in the UI.

## Run locally

No build step is required.

```bash
python -m http.server 8080
```

Open `http://localhost:8080/`.

## Calculations and pricing

Shopping groups ingredient names and units after trimming, case folding and collapsing whitespace. Pantry subtraction uses those same name/unit pairs; it does not convert `kg` to `g` or merge synonyms. Use consistent names and units. Quantities are rounded to two decimals; unquantified ingredients remain “as needed”. Profile constraints guide the external agent; the site does not certify allergy safety or enforce dietary suitability.

Optional pricing applies to the currently selected week. It compares whole-package purchase costs, converts compatible package mass/volume/count units, excludes expired quotes, and reports partial coverage when some items cannot be priced. Preferred stores take precedence when matching quotes are available. Cup/spoon conversions use fixed recipe conventions (`cup = 240 ml`, `tbsp = 15 ml`, `tsp = 5 ml`); ambiguous units are not converted between dimensions.

Set a user-chosen currency before saving quotes (`XXX` means unset). Profile budget currency and shopping currency are separate. Changing shopping currency clears existing quotes so amounts are never silently relabelled. Changing location through the human form resets the currency and clears quotes. Promotions are descriptive text; supply the effective single-package price. Estimates do not include delivery, tax adjustments or conditional multi-buy calculations, and the site does not fetch or verify prices itself.

## Checks

```bash
node --test tests/*.test.cjs
```

CI checks all application scripts for syntax, verifies referenced files and key surfaces, and runs the dependency-free Node regression suite. The suite executes the actual scripts in HTML order using a minimal DOM/WebMCP adapter. It checks all 25 documented registrations, state mutation, rollback, malformed storage, import validation and pricing calculations. It does not replace a real-browser check of layout, clipboard/download behavior, video playback or native WebMCP interoperability.

## Deployment

Meal Planner V2 is a static site. Serve the repository root over HTTPS.

Configuration is included for:

- Render (`render.yaml`)
- Netlify (`netlify.toml`)

## Main files

| File | Purpose |
| --- | --- |
| `index.html` | Application structure, views and script loading |
| `styles.css` | Base component styling |
| `shell.css` | AI Builders application shell and Profile styling |
| `app.js` | Core meal state, calculations, UI and WebMCP tools |
| `preferences.js` | Planning profile state and WebMCP tools |
| `sources.js` | Sources library, video embedding and WebMCP tools |
| `sources.css` | Sources styling |
| `shopping-pricing.js` | Package-aware price quotes and basket estimates |
| `shopping-localization.js` | User-chosen shopping currency tool |
| `import-data.js` | Validated core-state import |
| `recipe-view.js` / `recipe-view.css` | Read-only recipe view |
| `webmcp-status.js` | Shared registration and tool discovery status |

Scripts load once in the order shown in `index.html`: the status helper first, core function definitions next, then recipe view, pricing, currency, import validation, Sources and Profile. Core state loading and initial binding/rendering wait for `DOMContentLoaded`, when the importer’s validator and render extensions are available.

## License

MIT
