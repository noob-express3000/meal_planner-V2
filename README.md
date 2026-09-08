# The Watchlist

A minimal media-state service for an agent that maintains a human's watch environment around a physical-world goal.

## Scope

The repository owns:

- active goal/context;
- ordered recommendations;
- recommendation reasons and relevance;
- started/completed/skipped/abandoned state;
- watch-event history;
- basic behavioral aggregates;
- a human-facing queue/history interface;
- deterministic HTTP operations;
- WebMCP browser tools;
- a thin Strands Agents SDK adapter.

It does not attempt to be a streaming platform, social product, fitness coach, generic chatbot, or the complete Physical Transformation Bot.

## Architecture

```text
Human browser
    |
    | HTTP
    v
FastAPI + SQLite
    |
    +-- deterministic state transitions
    +-- behavioral event log
    +-- recommendation ordering
    |
    +--> WebMCP tools registered by static/app.js
    |
    +--> Strands tools in strands_adapter.py
```

The API remains the source of truth. WebMCP and Strands reuse the same operations rather than duplicating state logic.

## Data model

`goal_state`

- one active goal;
- optional context;
- updated timestamp.

`recommendations`

- title;
- media type;
- provider/URL when known;
- category;
- associated goal;
- selection reason;
- relevance score;
- queue priority;
- status: `recommended`, `started`, `completed`, `skipped`, `abandoned`;
- created/updated/started/completed timestamps.

`watch_events`

- recommendation id;
- interaction type;
- optional structured metadata;
- timestamp.

This preserves the state needed to observe sequences such as:

```text
recommended -> started -> completed
recommended -> skipped
started -> abandoned
```

The `/api/state` response also exposes a deliberately simple `predicted_next_watch_id`: the current highest-priority queued item. This creates a stable comparison point for a later prediction engine without pretending that a heuristic is ML.

## API

Core endpoints:

```text
GET    /api/state
GET    /api/goal
PUT    /api/goal
GET    /api/recommendations
POST   /api/recommendations
PATCH  /api/recommendations/{id}
DELETE /api/recommendations/{id}
POST   /api/recommendations/reorder
POST   /api/recommendations/{id}/interaction
GET    /api/history
GET    /api/behavior
GET    /healthz
```

`GET /api/recommendations` accepts optional `status`, `category`, and `goal` query parameters.

## WebMCP

`static/app.js` registers browser-native tools against the current `document.modelContext` API, with a fallback to the deprecated `navigator.modelContext` alias for transitional Chromium builds.

Exposed tools:

```text
watchlist_get_state
watchlist_query_media
watchlist_set_goal
watchlist_add_recommendation
watchlist_update_recommendation
watchlist_remove_recommendation
watchlist_reorder
watchlist_record_interaction
```

The page remains fully usable when WebMCP is unavailable.

## Strands Agents SDK

The Strands layer is intentionally thin. Deterministic CRUD and state transitions stay in FastAPI.

Install optional agent dependencies:

```bash
pip install -r requirements-agent.txt
```

`strands_adapter.py` exports:

```python
WATCHLIST_TOOLS
```

These tools can be passed into a separately configured Strands `Agent` using whichever model provider the final hackathon agent uses. The Watchlist does not initialize a default Bedrock-backed agent or require AWS credentials merely to run the web application.

Example integration shape:

```python
from strands import Agent
from strands_adapter import WATCHLIST_TOOLS

agent = Agent(
    model=your_configured_model,
    tools=WATCHLIST_TOOLS,
    system_prompt="Maintain the user's media environment around their stated goal.",
)
```

Set `WATCHLIST_BASE_URL` when the agent runs outside the same machine/container:

```text
WATCHLIST_BASE_URL=https://your-watchlist-host.example
```

## Local run

Python 3.12 is the deployment target.

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload
```

Open:

```text
http://127.0.0.1:8000
```

SQLite is created automatically at `data/watchlist.db` and seeded with a small runner-oriented demonstration queue.

To place the database elsewhere:

```text
DATA_DIR=/path/to/data
```

## Test

```bash
pip install -r requirements-dev.txt
pytest -q
node --check static/app.js
```

The integration tests prove:

```text
goal exists
-> recommendation added
-> recommendation appears in queue
-> interaction is recorded
-> completion/skip changes state
-> history updates
-> behavior state is available to an agent
```

GitHub Actions runs the same checks on push and pull request.

## Render

The root `render.yaml` is a Render Blueprint for the FastAPI service.

```text
build: pip install -r requirements.txt
start: uvicorn app:app --host 0.0.0.0 --port $PORT
health: /healthz
```

No credentials are hardcoded in the Blueprint.

The current demo uses local SQLite. Render instances have an ephemeral filesystem unless persistent storage is configured, so redeploys can reset local state. That is acceptable for the initial hackathon demo; durable production state should use a persistent disk or external database without changing the API contract.

## Demo flow

1. Open the site and inspect the active goal.
2. An agent calls `watchlist_get_state`.
3. The agent adds or reprioritizes a recommendation.
4. The recommendation appears in the human UI.
5. The human starts, completes, skips, or abandons it.
6. The state moves into history and an event is retained.
7. A later agent call sees the changed behavioral state and can adapt the next recommendation.
