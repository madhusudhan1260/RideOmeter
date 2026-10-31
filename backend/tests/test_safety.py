import uuid
from datetime import UTC, datetime, timedelta

from tests.conftest import ride_payload


def _now(**delta):
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


# ---- stops ---------------------------------------------------------------

def test_stop_request_lifecycle(ride_group):
    ride, admin, a, b = ride_group
    rid = ride["id"]
    r = a.post(f"/api/rides/{rid}/stops", {"type": "PETROL", "lat": 13.1, "lng": 77.6})
    assert r.status_code == 201
    stop = r.json()
    assert stop["announcement"] == "Petrol stop requested by Arjun."
    assert stop["status"] == "OPEN"

    assert b.post(f"/api/stops/{stop['id']}/acknowledge").status_code == 403
    ack = admin.post(f"/api/stops/{stop['id']}/acknowledge").json()
    assert ack["status"] == "ACKNOWLEDGED" and ack["handled_by"] == admin.id
    assert admin.post(f"/api/stops/{stop['id']}/approve").json()["status"] == "APPROVED"
    assert admin.post(f"/api/stops/{stop['id']}/complete").json()["status"] == "COMPLETED"
    assert admin.post(f"/api/stops/{stop['id']}/approve").status_code == 409

    history = a.get(f"/api/rides/{rid}/stops?include_closed=true").json()
    assert [s["status"] for s in history] == ["COMPLETED"]
    assert a.get(f"/api/rides/{rid}/stops").json() == []


def test_duplicate_stop_blocked_but_retry_idempotent(ride_group):
    ride, _, a, _ = ride_group
    rid = ride["id"]
    eid = str(uuid.uuid4())
    first = a.post(f"/api/rides/{rid}/stops", {"type": "FOOD", "client_event_id": eid})
    retry = a.post(f"/api/rides/{rid}/stops", {"type": "FOOD", "client_event_id": eid})
    assert first.status_code == 201 and retry.status_code == 200
    assert first.json()["id"] == retry.json()["id"]
    dup = a.post(f"/api/rides/{rid}/stops", {"type": "FOOD"})
    assert dup.status_code == 409 and dup.json()["stop_id"] == first.json()["id"]
    # A different type is fine.
    assert a.post(f"/api/rides/{rid}/stops", {"type": "REST"}).status_code == 201


def test_stop_expiry(ride_group):
    from app.core.database import SessionLocal
    from app.models import StopRequest

    ride, _, a, _ = ride_group
    stop = a.post(f"/api/rides/{ride['id']}/stops", {"type": "RESTROOM"}).json()
    with SessionLocal() as db:
        s = db.get(StopRequest, uuid.UUID(stop["id"]))
        s.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert a.get(f"/api/rides/{ride['id']}/stops").json() == []
    assert a.post(f"/api/rides/{ride['id']}/stops", {"type": "RESTROOM"}).status_code == 201


def test_requester_can_withdraw_own_request(ride_group):
    ride, _, a, b = ride_group
    stop = a.post(f"/api/rides/{ride['id']}/stops", {"type": "TEA_COFFEE"}).json()
    assert b.post(f"/api/stops/{stop['id']}/complete").status_code == 403
    assert a.post(f"/api/stops/{stop['id']}/complete").json()["status"] == "COMPLETED"


def test_custom_needs_note_and_ride_must_be_active(make_rider, ride_group):
    ride, _, a, _ = ride_group
    assert a.post(f"/api/rides/{ride['id']}/stops", {"type": "CUSTOM"}).status_code == 422
    admin = make_rider("Cap2")
    planned = admin.post("/api/rides", ride_payload()).json()
    assert admin.post(f"/api/rides/{planned['id']}/stops", {"type": "PETROL"}).status_code == 409


# ---- emergency ---------------------------------------------------------------

def test_emergency_delivery_is_not_assumed(ride_group):
    ride, admin, a, b = ride_group
    admin.put("/api/users/me", {})
    a.put("/api/users/me", {"emergency_contact_name": "Ravi", "emergency_contact_phone": "+91 90000 00000",
                            "blood_group": "O+"})
    e = a.post(f"/api/rides/{ride['id']}/emergency",
               {"type": "ACCIDENT", "lat": 13.2, "lng": 77.6, "location_recorded_at": _now(seconds=-30)}).json()
    assert e["announcement"] == "Accident reported by Arjun."
    assert e["recipients"] == 2 and e["delivered"] == 0  # nobody confirmed receipt yet
    assert e["emergency_contact"]["blood_group"] == "O+"

    assert a.post(f"/api/emergency/{e['id']}/acknowledge").status_code == 403
    acked = b.post(f"/api/emergency/{e['id']}/acknowledge").json()
    assert acked["status"] == "ACKNOWLEDGED" and acked["acknowledged_by"] == b.id
    assert b.post(f"/api/emergency/{e['id']}/resolve").status_code == 403
    assert admin.post(f"/api/emergency/{e['id']}/resolve").json()["status"] == "RESOLVED"
    assert a.get(f"/api/rides/{ride['id']}/emergency?active_only=true").json() == []


def test_emergency_idempotent_by_event_id(ride_group):
    ride, _, a, _ = ride_group
    eid = str(uuid.uuid4())
    one = a.post(f"/api/rides/{ride['id']}/emergency", {"type": "SOS", "client_event_id": eid})
    two = a.post(f"/api/rides/{ride['id']}/emergency", {"type": "SOS", "client_event_id": eid})
    assert one.status_code == 201 and two.status_code == 200 and one.json()["id"] == two.json()["id"]


# ---- locations ---------------------------------------------------------------

def test_location_freshness(ride_group):
    from app.core.database import SessionLocal
    from app.models import LocationUpdate

    ride, admin, a, b = ride_group
    rid = ride["id"]
    assert a.post(f"/api/rides/{rid}/locations", {"lat": 13.1, "lng": 77.6, "recorded_at": _now()}).status_code == 201
    assert admin.post(f"/api/rides/{rid}/locations",
                      {"lat": 13.0, "lng": 77.5, "recorded_at": _now(minutes=-10)}).status_code == 201
    with SessionLocal() as db:
        assert db.query(LocationUpdate).count() == 2

    rows = {r["user_id"]: r for r in b.get(f"/api/rides/{rid}/locations").json()}
    assert rows[a.id]["freshness"] == "LIVE"
    assert rows[admin.id]["freshness"] == "STALE" and rows[admin.id]["age_seconds"] >= 600
    assert rows[b.id]["freshness"] == "UNAVAILABLE" and rows[b.id]["lat"] is None


def test_location_sharing_off_hides_coordinates(ride_group):
    ride, _, a, b = ride_group
    rid = ride["id"]
    a.post(f"/api/rides/{rid}/locations", {"lat": 13.1, "lng": 77.6, "recorded_at": _now()})
    assert a.put(f"/api/rides/{rid}/location-sharing", {"enabled": False}).status_code == 200
    rows = {r["user_id"]: r for r in b.get(f"/api/rides/{rid}/locations").json()}
    assert rows[a.id]["freshness"] == "UNAVAILABLE" and rows[a.id]["lat"] is None and rows[a.id]["sharing"] is False
    assert a.post(f"/api/rides/{rid}/locations", {"lat": 1, "lng": 1, "recorded_at": _now()}).status_code == 403


def test_location_validation(ride_group):
    ride, _, a, _ = ride_group
    rid = ride["id"]
    assert a.post(f"/api/rides/{rid}/locations", {"lat": 95, "lng": 0, "recorded_at": _now()}).status_code == 422
    assert a.post(f"/api/rides/{rid}/locations",
                  {"lat": 1, "lng": 1, "recorded_at": _now(minutes=30)}).status_code == 400


def test_announcement_creates_notifications(ride_group):
    ride, admin, a, b = ride_group
    assert admin.post(f"/api/rides/{ride['id']}/announcements", {"text": "Fuel at next pump"}).status_code == 201
    notes = a.get("/api/notifications").json()
    assert any(n["type"] == "ANNOUNCEMENT" and n["body"] == "Fuel at next pump" for n in notes)
