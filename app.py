from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "watchlist.db"

app = FastAPI(title="The Watchlist", version="0.1.0")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS goal_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                goal TEXT NOT NULL,
                context TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recommendations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                media_type TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL,
                goal TEXT NOT NULL,
                reason TEXT NOT NULL,
                relevance REAL NOT NULL DEFAULT 0.5 CHECK (relevance >= 0 AND relevance <= 1),
                status TEXT NOT NULL DEFAULT 'recommended',
                priority INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS watch_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recommendation_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE
            );
            """
        )

        goal_count = conn.execute("SELECT COUNT(*) FROM goal_state").fetchone()[0]
        if goal_count == 0:
            conn.execute(
                "INSERT INTO goal_state (id, goal, context, updated_at) VALUES (1, ?, ?, ?)",
                (
                    "Become a runner",
                    "Build consistency, learn the culture of endurance sport, and stay motivated by exceptional physical achievement.",
                    now_iso(),
                ),
            )

        recommendation_count = conn.execute("SELECT COUNT(*) FROM recommendations").fetchone()[0]
        if recommendation_count == 0:
            seed = [
                (
                    "Breaking2",
                    "documentary",
                    "National Geographic",
                    "Endurance / elite performance",
                    "Become a runner",
                    "A direct look at elite marathon preparation, pacing, teamwork, and the attempt to break the two-hour marathon barrier.",
                    0.98,
                    0,
                ),
                (
                    "The Barkley Marathons: The Race That Eats Its Young",
                    "documentary",
                    "",
                    "Endurance / culture",
                    "Become a runner",
                    "Shows an extreme endurance event, its culture, and the persistence required to keep moving when completion is unlikely.",
                    0.90,
                    1,
                ),
                (
                    "Free Solo",
                    "documentary",
                    "National Geographic Documentary Films",
                    "Motivation / exceptional physical achievement",
                    "Become a runner",
                    "Selected as an adjacent example of extreme physical discipline, preparation, risk management, and long-term focus.",
                    0.78,
                    2,
                ),
            ]
            timestamp = now_iso()
            conn.executemany(
                """
                INSERT INTO recommendations (
                    title, media_type, provider, category, goal, reason,
                    relevance, priority, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(*item, timestamp, timestamp) for item in seed],
            )


init_db()


class GoalUpdate(BaseModel):
    goal: str = Field(min_length=2, max_length=240)
    context: str = Field(default="", max_length=2000)


class RecommendationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    media_type: str = Field(min_length=1, max_length=80)
    provider: str = Field(default="", max_length=160)
    url: str = Field(default="", max_length=1000)
    category: str = Field(min_length=1, max_length=180)
    goal: str = Field(min_length=1, max_length=240)
    reason: str = Field(min_length=1, max_length=2000)
    relevance: float = Field(default=0.5, ge=0, le=1)
    priority: int | None = Field(default=None, ge=0)


class RecommendationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    media_type: str | None = Field(default=None, min_length=1, max_length=80)
    provider: str | None = Field(default=None, max_length=160)
    url: str | None = Field(default=None, max_length=1000)
    category: str | None = Field(default=None, min_length=1, max_length=180)
    goal: str | None = Field(default=None, min_length=1, max_length=240)
    reason: str | None = Field(default=None, min_length=1, max_length=2000)
    relevance: float | None = Field(default=None, ge=0, le=1)
    status: Literal["recommended", "started", "completed", "skipped", "abandoned"] | None = None
    priority: int | None = Field(default=None, ge=0)


class ReorderRequest(BaseModel):
    ids: list[int] = Field(min_length=1)


class InteractionRequest(BaseModel):
    event: Literal["started", "watched", "completed", "skipped", "abandoned"]
    metadata: dict[str, Any] = Field(default_factory=dict)


def get_recommendation(conn: sqlite3.Connection, recommendation_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM recommendations WHERE id = ?", (recommendation_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return row


def behavioral_summary(conn: sqlite3.Connection) -> dict[str, Any]:
    counts = {
        row["status"]: row["count"]
        for row in conn.execute(
            "SELECT status, COUNT(*) AS count FROM recommendations GROUP BY status"
        ).fetchall()
    }
    category_rows = conn.execute(
        """
        SELECT category,
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM recommendations
        GROUP BY category
        ORDER BY completed DESC, total DESC, category ASC
        """
    ).fetchall()
    return {
        "status_counts": counts,
        "category_engagement": [dict(row) for row in category_rows],
        "total_events": conn.execute("SELECT COUNT(*) FROM watch_events").fetchone()[0],
    }


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/goal")
def read_goal() -> dict[str, Any]:
    with db() as conn:
        return row_dict(conn.execute("SELECT * FROM goal_state WHERE id = 1").fetchone()) or {}


@app.put("/api/goal")
def update_goal(payload: GoalUpdate) -> dict[str, Any]:
    with db() as conn:
        conn.execute(
            "UPDATE goal_state SET goal = ?, context = ?, updated_at = ? WHERE id = 1",
            (payload.goal, payload.context, now_iso()),
        )
        return row_dict(conn.execute("SELECT * FROM goal_state WHERE id = 1").fetchone()) or {}


@app.get("/api/recommendations")
def list_recommendations(
    status: str | None = Query(default=None),
    category: str | None = Query(default=None),
    goal: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if category:
        clauses.append("category = ?")
        params.append(category)
    if goal:
        clauses.append("goal = ?")
        params.append(goal)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with db() as conn:
        rows = conn.execute(
            f"SELECT * FROM recommendations {where} ORDER BY priority ASC, created_at ASC",
            params,
        ).fetchall()
        return [dict(row) for row in rows]


@app.post("/api/recommendations", status_code=201)
def create_recommendation(payload: RecommendationCreate) -> dict[str, Any]:
    with db() as conn:
        priority = payload.priority
        if priority is None:
            priority = conn.execute(
                "SELECT COALESCE(MAX(priority), -1) + 1 FROM recommendations WHERE status IN ('recommended', 'started')"
            ).fetchone()[0]
        timestamp = now_iso()
        cursor = conn.execute(
            """
            INSERT INTO recommendations (
                title, media_type, provider, url, category, goal, reason,
                relevance, priority, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.title,
                payload.media_type,
                payload.provider,
                payload.url,
                payload.category,
                payload.goal,
                payload.reason,
                payload.relevance,
                priority,
                timestamp,
                timestamp,
            ),
        )
        return dict(get_recommendation(conn, cursor.lastrowid))


@app.patch("/api/recommendations/{recommendation_id}")
def update_recommendation(recommendation_id: int, payload: RecommendationUpdate) -> dict[str, Any]:
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No changes supplied")
    changes["updated_at"] = now_iso()
    with db() as conn:
        get_recommendation(conn, recommendation_id)
        columns = ", ".join(f"{key} = ?" for key in changes)
        conn.execute(
            f"UPDATE recommendations SET {columns} WHERE id = ?",
            [*changes.values(), recommendation_id],
        )
        return dict(get_recommendation(conn, recommendation_id))


@app.delete("/api/recommendations/{recommendation_id}", status_code=204)
def delete_recommendation(recommendation_id: int) -> None:
    with db() as conn:
        get_recommendation(conn, recommendation_id)
        conn.execute("DELETE FROM recommendations WHERE id = ?", (recommendation_id,))


@app.post("/api/recommendations/reorder")
def reorder_recommendations(payload: ReorderRequest) -> list[dict[str, Any]]:
    if len(payload.ids) != len(set(payload.ids)):
        raise HTTPException(status_code=400, detail="Duplicate recommendation ids")
    with db() as conn:
        existing = {
            row[0]
            for row in conn.execute(
                f"SELECT id FROM recommendations WHERE id IN ({','.join('?' for _ in payload.ids)})",
                payload.ids,
            ).fetchall()
        }
        missing = [item for item in payload.ids if item not in existing]
        if missing:
            raise HTTPException(status_code=404, detail={"missing_ids": missing})
        timestamp = now_iso()
        for priority, recommendation_id in enumerate(payload.ids):
            conn.execute(
                "UPDATE recommendations SET priority = ?, updated_at = ? WHERE id = ?",
                (priority, timestamp, recommendation_id),
            )
        rows = conn.execute(
            "SELECT * FROM recommendations WHERE status IN ('recommended', 'started') ORDER BY priority ASC"
        ).fetchall()
        return [dict(row) for row in rows]


@app.post("/api/recommendations/{recommendation_id}/interaction")
def record_interaction(recommendation_id: int, payload: InteractionRequest) -> dict[str, Any]:
    status_map = {
        "started": "started",
        "watched": None,
        "completed": "completed",
        "skipped": "skipped",
        "abandoned": "abandoned",
    }
    timestamp = now_iso()
    with db() as conn:
        current = get_recommendation(conn, recommendation_id)
        conn.execute(
            "INSERT INTO watch_events (recommendation_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)",
            (recommendation_id, payload.event, json.dumps(payload.metadata), timestamp),
        )

        target_status = status_map[payload.event]
        if target_status:
            fields = ["status = ?", "updated_at = ?"]
            values: list[Any] = [target_status, timestamp]
            if payload.event == "started" and not current["started_at"]:
                fields.append("started_at = ?")
                values.append(timestamp)
            if payload.event == "completed":
                fields.append("completed_at = ?")
                values.append(timestamp)
            values.append(recommendation_id)
            conn.execute(
                f"UPDATE recommendations SET {', '.join(fields)} WHERE id = ?",
                values,
            )
        else:
            conn.execute(
                "UPDATE recommendations SET updated_at = ? WHERE id = ?",
                (timestamp, recommendation_id),
            )

        recommendation = dict(get_recommendation(conn, recommendation_id))
        return {"recommendation": recommendation, "event": payload.event}


@app.get("/api/history")
def history() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM recommendations
            WHERE status IN ('completed', 'skipped', 'abandoned')
            ORDER BY updated_at DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]


@app.get("/api/behavior")
def behavior() -> dict[str, Any]:
    with db() as conn:
        return behavioral_summary(conn)


@app.get("/api/state")
def state() -> dict[str, Any]:
    with db() as conn:
        goal = row_dict(conn.execute("SELECT * FROM goal_state WHERE id = 1").fetchone()) or {}
        queue_rows = conn.execute(
            """
            SELECT * FROM recommendations
            WHERE status IN ('recommended', 'started')
            ORDER BY priority ASC, created_at ASC
            """
        ).fetchall()
        history_rows = conn.execute(
            """
            SELECT * FROM recommendations
            WHERE status IN ('completed', 'skipped', 'abandoned')
            ORDER BY updated_at DESC
            """
        ).fetchall()
        queue = [dict(row) for row in queue_rows]
        history_items = [dict(row) for row in history_rows]
        return {
            "goal": goal,
            "up_next": queue[0] if queue else None,
            "watchlist": queue,
            "history": history_items,
            "behavior": behavioral_summary(conn),
            "prediction": {
                "predicted_next_watch_id": queue[0]["id"] if queue else None,
                "basis": "Current queue priority; placeholder for a later prediction engine.",
            },
        }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


app.mount("/assets", StaticFiles(directory=BASE_DIR / "static"), name="assets")
