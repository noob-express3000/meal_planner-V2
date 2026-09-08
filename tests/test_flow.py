from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_surface_has_no_server_seed_data():
    response = client.get("/")
    assert response.status_code == 200
    html = response.text
    assert "Breaking2" not in html
    assert "Become a runner" not in html
    assert "Barkley" not in html
    assert "Free Solo" not in html
    assert "indexedDB" not in html  # state implementation is loaded from app.js, not serialized into HTML


def test_deleted_state_api_is_not_exposed():
    assert client.get("/api/state").status_code == 404
    assert client.get("/api/recommendations").status_code == 404
