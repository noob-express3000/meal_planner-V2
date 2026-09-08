# Meal Planner — AI Builders 2026

This repository is the **AI Builders competition variant** of Meal Planner.

Baseline: copied from `noob-express3000/meal_planner` on **2026-09-08**. The original repository remains separate and is not the working repository for this entry. All competition changes are made here in `noob-express3000/the-watchlist`.

## Product

Meal Planner is a local-first planning surface that can be operated by either a human or a WebMCP-capable AI agent.

The website owns structured state, validation and deterministic calculations. The agent handles reasoning, research and multi-step orchestration.

No account, database or embedded model is required.

## Current interface

Five sections:

- **Weekly plan** — breakfast, lunch and dinner slots by date
- **Recipes** — structured ingredients, servings, cooking time and instructions
- **Pantry** — quantities already available
- **Shopping** — calculated requirements after recipe scaling and pantry subtraction
- **Sources** — videos, articles and references used by the human or agent

Supported video sources can play directly inside the Sources view:

- YouTube
- Vimeo
- direct MP4/WebM/OGG URLs

Other sources remain normal external links.

A source may optionally reference a saved recipe. This provides lightweight provenance: an agent can create a recipe and leave behind the article or video it used.

## Local state

Core meal-planning state is stored in browser `localStorage`:

- `meal-planner.webmcp.v1` — recipes, meal plans and pantry
- `meal-planner.shopping-pricing.v1` — optional shopping profile and saved price quotes
- `meal-planner.sources.v1` — videos, articles, references and recipe provenance

State belongs to the current browser profile and site origin.

## WebMCP

The application exposes structured browser tools with `document.modelContext.registerTool()`.

### Planning and recipes

- `meal_context`
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

The WebMCP status indicator reports the tools actually discoverable by the browser rather than relying on a hard-coded count.

## Agent workflow

Example objective:

> Plan four cheap dinners for this week, use what I already have, avoid repeating last week, add the recipes I am missing, save the useful sources you relied on, then build my shopping list.

A capable agent can:

1. Read the existing meal context.
2. Inspect recipes and pantry inventory.
3. Research or select appropriate meals.
4. Save new recipes when needed.
5. Store useful videos/articles as sources.
6. Write the approved weekly plan.
7. Calculate the shopping list.
8. Optionally research local package prices and promotions.

Every mutation is immediately visible in the same interface the human uses.

## Architecture

```text
Human ───────────────┐
                     ▼
                 Web interface
                     │
AI agent ─ WebMCP ───┤
                     ▼
                 localStorage
                     │
       deterministic calculations
```

The application remains useful when WebMCP is unavailable. WebMCP adds machine-operable access to the same state and functions rather than creating a second backend implementation.

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
| `index.html` | Application markup and navigation |
| `styles.css` | Main interface styling |
| `app.js` | Meal state, calculations, UI and core WebMCP tools |
| `sources.js` | Local source library, video embedding and source WebMCP tools |
| `sources.css` | Sources interface styling |
| `shopping-pricing.js` | Price quotes and package-aware basket estimates |
| `shopping-localization.js` | Agent-resolved shopping currency |
| `import-data.js` | Validated state import |
| `recipe-view.js` | Read-only recipe view |
| `webmcp-status.js` | Live WebMCP tool discovery status |

## License

MIT
