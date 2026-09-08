from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_goal_recommendation_interaction_history_flow():
    goal = client.put(
        "/api/goal",
        json={
            "goal": "Become a climber",
            "context": "Build confidence, movement literacy, and familiarity with climbing culture.",
        },
    )
    assert goal.status_code == 200
    assert goal.json()["goal"] == "Become a climber"

    created = client.post(
        "/api/recommendations",
        json={
            "title": "Demo Climbing Film",
            "media_type": "video",
            "category": "Technique / culture",
            "goal": "Become a climber",
            "reason": "Used in the deterministic integration test to prove recommendation state transitions.",
            "relevance": 0.8,
        },
    )
    assert created.status_code == 201
    recommendation_id = created.json()["id"]

    state = client.get("/api/state")
    assert state.status_code == 200
    assert any(item["id"] == recommendation_id for item in state.json()["watchlist"])

    started = client.post(
        f"/api/recommendations/{recommendation_id}/interaction",
        json={"event": "started", "metadata": {"source": "test"}},
    )
    assert started.status_code == 200
    assert started.json()["recommendation"]["status"] == "started"

    completed = client.post(
        f"/api/recommendations/{recommendation_id}/interaction",
        json={"event": "completed"},
    )
    assert completed.status_code == 200
    assert completed.json()["recommendation"]["status"] == "completed"

    history = client.get("/api/history")
    assert history.status_code == 200
    assert any(item["id"] == recommendation_id for item in history.json())

    final_state = client.get("/api/state").json()
    assert not any(item["id"] == recommendation_id for item in final_state["watchlist"])
    assert any(item["id"] == recommendation_id for item in final_state["history"])
    assert final_state["behavior"]["total_events"] >= 2


def test_reorder_and_skip_flow():
    first = client.post(
        "/api/recommendations",
        json={
            "title": "Queue A",
            "media_type": "video",
            "category": "Test",
            "goal": "Become a runner",
            "reason": "Queue ordering test.",
        },
    ).json()
    second = client.post(
        "/api/recommendations",
        json={
            "title": "Queue B",
            "media_type": "video",
            "category": "Test",
            "goal": "Become a runner",
            "reason": "Queue ordering test.",
        },
    ).json()

    reordered = client.post(
        "/api/recommendations/reorder",
        json={"ids": [second["id"], first["id"]]},
    )
    assert reordered.status_code == 200
    returned_ids = [item["id"] for item in reordered.json()]
    assert returned_ids.index(second["id"]) < returned_ids.index(first["id"])

    skipped = client.post(
        f"/api/recommendations/{second['id']}/interaction",
        json={"event": "skipped"},
    )
    assert skipped.status_code == 200
    assert skipped.json()["recommendation"]["status"] == "skipped"
