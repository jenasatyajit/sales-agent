"""REST API contract tests (BACKEND.md Phase 4)."""

from uuid import uuid4


async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_seed_personas_present(client):
    resp = await client.get("/api/personas")
    assert resp.status_code == 200
    names = {p["name"] for p in resp.json()}
    assert {"Rohan Kapoor", "Vikram Mehta", "Rajesh Bansal"} <= names


async def test_create_persona_validation(client):
    resp = await client.post("/api/personas", json={"name": "x"})
    assert resp.status_code == 422
    bad_voice = {
        "name": "A",
        "role_title": "B",
        "company_profile": "C",
        "sarvam_voice_id": "anushka",  # v3-era name still accepted here (free text), but…
        "initial_trust_score": 200,  # …out-of-range trust must be rejected
    }
    resp = await client.post("/api/personas", json=bad_voice)
    assert resp.status_code == 422


async def test_session_lifecycle_without_live_call(client):
    # Create persona + session
    resp = await client.post(
        "/api/personas",
        json={
            "name": "Test Buyer",
            "role_title": "CTO",
            "company_profile": "10-person startup",
            "language_mode": "en-IN",
            "sarvam_voice_id": "simran_en_conversation",
            "status_quo_stack": ["Excel"],
            "hidden_pain_points": ["manual reports"],
            "switching_objections": ["downtime"],
            "call_scenario": "cold_call",
            "initial_trust_score": 25,
        },
    )
    assert resp.status_code == 201
    persona = resp.json()

    resp = await client.post(
        "/api/sessions",
        json={"persona_id": persona["id"], "product_context": "An ops copilot."},
    )
    assert resp.status_code == 201
    session = resp.json()
    assert session["ended_at"] is None

    # Detail before any call activity
    resp = await client.get(f"/api/sessions/{session['id']}")
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["evaluation_status"] == "live"
    assert detail["persona"]["name"] == "Test Buyer"
    assert detail["turns"] == []
    assert detail["evaluation"] is None

    # Summaries list contains the session
    resp = await client.get("/api/sessions")
    assert any(s["id"] == session["id"] for s in resp.json())

    # End without a live pipeline (crash-recovery path) finalizes + schedules evaluation
    resp = await client.post(f"/api/sessions/{session['id']}/end")
    assert resp.status_code == 200

    # Idempotent second end
    resp = await client.post(f"/api/sessions/{session['id']}/end")
    assert resp.status_code == 200
    assert resp.json()["status"] == "already_ended"


async def test_unknown_ids_return_404(client):
    assert (await client.get(f"/api/sessions/{uuid4()}")).status_code == 404
    resp = await client.post(
        "/api/sessions", json={"persona_id": str(uuid4()), "product_context": "x"}
    )
    assert resp.status_code == 404
    resp = await client.post(f"/api/sessions/{uuid4()}/end")
    assert resp.status_code == 404
