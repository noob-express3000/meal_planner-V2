from __future__ import annotations

import os
from typing import Any

import httpx
from strands import tool

BASE_URL = os.getenv("WATCHLIST_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def _request(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    with httpx.Client(base_url=BASE_URL, timeout=15.0) as client:
        response = client.request(method, path, json=payload)
        response.raise_for_status()
        if response.status_code == 204:
            return None
        return response.json()


@tool
def get_watchlist_state() -> dict[str, Any]:
    """Read the active goal, ordered watchlist, history, behavioral summary, and current next-watch prediction."""
    return _request("GET", "/api/state")


@tool
def set_watchlist_goal(goal: str, context: str = "") -> dict[str, Any]:
    """Set the user's active physical-world goal and optional context for media curation."""
    return _request("PUT", "/api/goal", {"goal": goal, "context": context})


@tool
def add_watchlist_recommendation(
    title: str,
    media_type: str,
    category: str,
    goal: str,
    reason: str,
    relevance: float = 0.5,
    provider: str = "",
    url: str = "",
) -> dict[str, Any]:
    """Add a recommendation with an explicit goal association and reason for selection."""
    return _request(
        "POST",
        "/api/recommendations",
        {
            "title": title,
            "media_type": media_type,
            "category": category,
            "goal": goal,
            "reason": reason,
            "relevance": relevance,
            "provider": provider,
            "url": url,
        },
    )


@tool
def record_watchlist_interaction(
    recommendation_id: int,
    event: str,
) -> dict[str, Any]:
    """Record that a recommendation was started, watched, completed, skipped, or abandoned."""
    return _request(
        "POST",
        f"/api/recommendations/{recommendation_id}/interaction",
        {"event": event},
    )


WATCHLIST_TOOLS = [
    get_watchlist_state,
    set_watchlist_goal,
    add_watchlist_recommendation,
    record_watchlist_interaction,
]
