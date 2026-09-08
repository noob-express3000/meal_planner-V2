# The Watchlist

A minimal human-agent media surface.

The server does not own the watchlist. It only serves the interface.

## Model

```text
Human ─┐
       ├── browser surface ── IndexedDB
Agent ─┘          │
                  └── WebMCP tools
```

A fresh browser starts empty.

There is no seeded goal, recommendation list, history, prediction model, or demo content. The human or connected agent creates the state.

## Local state

IndexedDB stores:

- current goal and context;
- ordered media queue;
- media metadata;
- thumbnails supplied by an agent;
- thumbnail alt text;
- started/completed/skipped/abandoned state;
- interaction events.

Render receives none of that state during normal use.

## Interface

The human surface contains three tabs:

```text
Up next
Watchlist
History
```

The active goal appears only when one exists. Empty state is intentionally blank.

Media thumbnails have visual weight only when the agent supplies them. The surface does not invent titles, artwork, descriptions, goals, categories, or reasons.

## WebMCP

The browser exposes the same local state to an agent through WebMCP:

```text
watchlist_get_state
watchlist_set_goal
watchlist_add_media
watchlist_update_media
watchlist_remove_media
watchlist_reorder
watchlist_record_interaction
watchlist_clear_surface
```

`watchlist_add_media` accepts only a title as mandatory input. Everything else is optional and agent-supplied:

```text
media_type
provider
url
category
purpose
reason
thumbnail
alt_text
position
status
```

`thumbnail` may be a normal image URL or a data URL. `alt_text` exists so an agent can make agent-supplied artwork accessible to screen readers as part of the same operation.

## Server

FastAPI is deliberately stateless:

```text
GET /          interface
GET /healthz   health check
```

No media CRUD API exists. State manipulation happens in the browser through IndexedDB and WebMCP.

## Local run

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

## Test

```bash
pip install -r requirements-dev.txt
python -m pytest -q
node --check static/app.js
```

CI verifies that the server remains stateless and that demo content is not serialized into the shipped interface.

## Render

`render.yaml` explicitly uses Render's free web-service plan.

```text
build: pip install -r requirements.txt
start: uvicorn app:app --host 0.0.0.0 --port $PORT
health: /healthz
```

Because persistent application state is browser-local, Render's ephemeral filesystem is irrelevant to the Watchlist state model.
