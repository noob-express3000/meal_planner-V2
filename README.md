# FoodFromThought — AI Builders 2026

FoodFromThought is the **AI Builders 2026 competition variant** developed in `noob-express3000/the-watchlist`.

Baseline: copied from `noob-express3000/meal_planner` on **2026-09-08**. The original Meal Planner repository remains separate. All competition work after that copy is made here.

## Product

FoodFromThought is a local-first food-planning environment that can be operated by either a human or a WebMCP-capable AI agent.

The website owns structured state, validation, persistence and deterministic calculations. The agent handles reasoning, selection, research and multi-step orchestration.

No account, hosted database, embedded model or application API key is required.

## Interface

Six primary views:

- **Plan** — dated breakfast, lunch and dinner slots
- **Recipes** — structured servings, ingredients, cooking time and instructions
- **Pantry** — quantities already available
- **Shopping** — calculated requirements after recipe scaling and pantry subtraction
- **Sources** — videos, articles and references saved by the human or agent
- **Profile** — persistent planning constraints and goals

The AI Builders variant uses a fixed application shell on desktop and compact navigation on smaller screens. Human-facing controls and agent-facing tools operate the same underlying state.

## Planning profile

The Profile view stores reusable constraints instead of requiring the user to repeat them for every planning session:

- household size
- dietary restrictions
- allergies
- disliked foods
- weekly budget and currency
- available cooking equipment
- maximum cooking time
- planning goals such as high-protein, low-cost or meal prep

Profile state is browser-local and exposed to agents through two tools:

- `get_preferences`
- `set_preferences`

`set_preferences` performs partial updates. An agent can therefore remember a newly stated allergy or equipment constraint without replacing unrelated preferences.

## Sources and provenance

Sources are a first-class part of the product rather than transient links in a chat response.

Supported video URLs can play directly inside the Sources view:

- YouTube
- Vimeo
- direct MP4/WebM/OGG URLs

Other sources remain normal external links.

A source can optionally reference a saved recipe. This gives the user lightweight provenance: when an agent researches or creates a recipe, it can leave behind the article, video or reference it used.

WebMCP tools:

- `list_sources`
- `save_source`
- `delete_source`

## Local state

State is persisted in browser `localStorage` and belongs to the current site origin/browser profile.

The storage keys retain the original `meal-planner` namespace so existing browser data survives the FoodFromThought rebrand:

- `meal-planner.webmcp.v1` — recipes, meal plans and pantry
- `meal-planner.shopping-pricing.v1` — optional shopping profile and saved price quotes
- `meal-planner.sources.v1` — videos, articles, references and recipe provenance
- `meal-planner.preferences.v1` — household constraints, budget, equipment and goals

The product remains usable when WebMCP is unavailable.

## WebMCP surface

The application exposes structured browser tools through `document.modelContext.registerTool()`.

### Context and profile

- `meal_context`
- `get_preferences`
- `set_preferences`

### Planning and recipes

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

The WebMCP indicator reports the tools actually discoverable through the browser rather than using a hard-coded count.

## Example agent workflow

Objective:

> I have R800 for groceries this week. We are two people. Keep dinners high-protein, under 30 minutes, and avoid peanuts. Use what is already in my pantry. Add any recipes I need, keep the useful sources you relied on, plan the week, then build my shopping list.

A capable agent can:

1. Read `get_preferences` and the existing meal context.
2. Save newly stated constraints with `set_preferences`.
3. Inspect recipes, prior meal history and pantry inventory.
4. Select or research meals that satisfy the profile.
5. Save missing recipes.
6. Save useful supporting videos/articles in Sources.
7. Write the approved weekly plan.
8. Calculate the shopping list after pantry subtraction.
9. Optionally research local package prices and promotions.

Every mutation is immediately visible in the same interface the human uses.

## Architecture

```text
Human ─────────────────────┐
                           ▼
                   FoodFromThought
                           │
AI agent ─── WebMCP ───────┤
                           ▼
                      localStorage
                           │
             deterministic calculations
```

There is no separate MCP server. WebMCP tool registration and execution happen directly in the page.

## Why this structure

The project deliberately minimizes moving parts:

- one static web application
- browser-local persistence
- no authentication layer
- no server database
- no hosted inference dependency
- no duplicate agent backend
- deterministic meal and shopping calculations
- optional machine operation through WebMCP

The AI is useful because it can operate the planning environment, not because the website wraps a chat completion endpoint.

## Run locally

No build step is required.

```bash
python -m http.server 8080
```

Open `http://localhost:8080/`.

## Deployment

The project is a static site. Serve the repository root over HTTPS.

Deployment configuration is included for Render and Netlify.

## Main files

| File | Purpose |
| --- | --- |
| `index.html` | Application structure and navigation |
| `styles.css` | Base component styling |
| `shell.css` | AI Builders application shell and Profile styling |
| `brand.css` | FoodFromThought branding and darker palette overrides |
| `favicon.svg` | FoodFromThought monogram |
| `app.js` | Meal state, calculations, UI and core WebMCP tools |
| `preferences.js` | Persistent planning profile and preference WebMCP tools |
| `sources.js` | Source library, video embedding and source WebMCP tools |
| `sources.css` | Source-specific styling |
| `shopping-pricing.js` | Price quotes and package-aware basket estimates |
| `shopping-localization.js` | Agent-resolved shopping currency |
| `import-data.js` | Validated core meal-state import |
| `recipe-view.js` | Read-only recipe view |
| `webmcp-status.js` | Live WebMCP tool discovery status |

## License

MIT
