import uuid
from datetime import UTC, datetime, timedelta

import pytest
from starlette.websockets import WebSocketDisconnect


def _connect(client, ride_id, rider):
    ws = client.websocket_connect(f"/ws/rides/{ride_id}")
    sock = ws.__enter__()
    sock.send_json({"type": "auth", "token": rider.tokens["access_token"]})
    presence = sock.receive_json()
    assert presence["event_type"] == "PRESENCE"
    return ws, sock


def _next_of(sock, event_type, limit=10):
    for _ in range(limit):
        msg = sock.receive_json()
        if msg["event_type"] == event_type:
            return msg
    raise AssertionError(f"{event_type} not received")


def test_ws_rejects_bad_token(client, ride_group):
    ride, *_ = ride_group
    with client.websocket_connect(f"/ws/rides/{ride['id']}") as ws:
        ws.send_json({"type": "auth", "token": "garbage"})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_ws_rejects_non_participant(client, ride_group, make_rider):
    ride, *_ = ride_group
    outsider = make_rider("Out")
    with client.websocket_connect(f"/ws/rides/{ride['id']}") as ws:
        ws.send_json({"type": "auth", "token": outsider.tokens["access_token"]})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4404


def test_rest_events_are_broadcast(client, ride_group):
    ride, admin, a, _ = ride_group
    ctx, sock = _connect(client, ride["id"], admin)
    try:
        a.post(f"/api/rides/{ride['id']}/stops", {"type": "PETROL"})
        ev = _next_of(sock, "STOP_REQUESTED")
        assert ev["sender_id"] == a.id
        assert ev["payload"]["announcement"] == "Petrol stop requested by Arjun."
        assert set(ev) >= {"event_id", "event_type", "ride_id", "sender_id", "timestamp", "payload",
                           "delivery_status"}
    finally:
        ctx.__exit__(None, None, None)


def test_clock_ping(client, ride_group):
    ride, admin, *_ = ride_group
    ctx, sock = _connect(client, ride["id"], admin)
    try:
        sock.send_json({"event_type": "CLOCK_PING", "payload": {"client_time": 123}})
        pong = _next_of(sock, "CLOCK_PONG")
        assert pong["payload"]["client_time"] == 123 and pong["payload"]["server_time"] > 0
    finally:
        ctx.__exit__(None, None, None)


def test_member_cannot_send_admin_event(client, ride_group):
    ride, _, a, _ = ride_group
    ctx, sock = _connect(client, ride["id"], a)
    try:
        eid = str(uuid.uuid4())
        sock.send_json({"event_id": eid, "event_type": "ADMIN_ANNOUNCEMENT", "payload": {"text": "hi"}})
        err = _next_of(sock, "ERROR")
        assert err["payload"]["ref_event_id"] == eid and err["delivery_status"] == "FAILED"
    finally:
        ctx.__exit__(None, None, None)


def test_sos_over_ws_with_delivery_ack(client, ride_group):
    ride, admin, a, b = ride_group
    ctx_a, sock_a = _connect(client, ride["id"], a)
    ctx_b, sock_b = _connect(client, ride["id"], b)
    try:
        eid = str(uuid.uuid4())
        sock_a.send_json({"event_id": eid, "event_type": "EMERGENCY_CREATED",
                          "payload": {"type": "SOS", "lat": 13.0, "lng": 77.0}})
        created = _next_of(sock_b, "EMERGENCY_CREATED")
        assert created["event_id"] == eid
        emergency_id = created["payload"]["id"]
        sock_b.send_json({"event_type": "DELIVERY_ACK", "payload": {"ref_id": emergency_id}})
        ack = _next_of(sock_a, "DELIVERY_ACK", limit=20)
        while ack["payload"].get("user_id") != b.id:
            ack = _next_of(sock_a, "DELIVERY_ACK", limit=20)
        state = a.get(f"/api/rides/{ride['id']}/emergency").json()[0]
        assert state["recipients"] == 2 and state["delivered"] == 1
    finally:
        ctx_b.__exit__(None, None, None)
        ctx_a.__exit__(None, None, None)


def test_location_over_ws_reaches_others_only(client, ride_group):
    ride, admin, a, _ = ride_group
    ctx_adm, sock_adm = _connect(client, ride["id"], admin)
    ctx_a, sock_a = _connect(client, ride["id"], a)
    try:
        sock_a.send_json({"event_type": "LOCATION_UPDATED",
                          "payload": {"lat": 13.0, "lng": 77.0, "recorded_at": datetime.now(UTC).isoformat()}})
        loc = _next_of(sock_adm, "LOCATION_UPDATED")
        assert loc["payload"]["user_id"] == a.id
    finally:
        ctx_a.__exit__(None, None, None)
        ctx_adm.__exit__(None, None, None)


def test_offline_sync(ride_group):
    ride, admin, a, _ = ride_group
    rid = ride["id"]
    t = datetime.now(UTC) - timedelta(minutes=3)
    stop_eid, loc_eid = str(uuid.uuid4()), str(uuid.uuid4())
    batch = {"events": [
        {"event_id": stop_eid, "event_type": "STOP_REQUESTED", "ride_id": rid, "sender_id": a.id,
         "timestamp": t.isoformat(), "payload": {"type": "PETROL"}},
        {"event_id": loc_eid, "event_type": "LOCATION_UPDATED", "ride_id": rid, "sender_id": a.id,
         "timestamp": t.isoformat(), "payload": {"lat": 13.0, "lng": 77.0}},
        {"event_id": str(uuid.uuid4()), "event_type": "STOP_REQUESTED", "ride_id": rid, "sender_id": admin.id,
         "timestamp": t.isoformat(), "payload": {"type": "FOOD"}},
        {"event_id": str(uuid.uuid4()), "event_type": "ADMIN_ANNOUNCEMENT", "ride_id": rid, "sender_id": a.id,
         "timestamp": t.isoformat(), "payload": {"text": "fake admin"}},
        {"event_id": str(uuid.uuid4()), "event_type": "STOP_REQUESTED", "ride_id": rid, "sender_id": a.id,
         "timestamp": (datetime.now(UTC) + timedelta(hours=1)).isoformat(), "payload": {"type": "REST"}},
    ]}
    res = {r["event_id"]: r for r in a.post("/api/sync/events", batch).json()["results"]}
    assert res[stop_eid]["result"] == "ACCEPTED"
    assert res[loc_eid]["result"] == "ACCEPTED"
    results = [r["result"] for r in res.values()]
    assert results.count("REJECTED") == 3  # forged sender, member admin event, future timestamp

    again = a.post("/api/sync/events", batch).json()["results"]
    assert {r["event_id"]: r["result"] for r in again}[stop_eid] == "DUPLICATE"

    stops = a.get(f"/api/rides/{rid}/stops").json()
    assert len(stops) == 1 and stops[0]["type"] == "PETROL"

    # Admin acknowledged the stop while offline.
    ack = {"events": [{"event_id": str(uuid.uuid4()), "event_type": "STOP_ACKNOWLEDGED", "ride_id": rid,
                       "sender_id": admin.id, "timestamp": datetime.now(UTC).isoformat(),
                       "payload": {"stop_id": stops[0]["id"]}}]}
    assert admin.post("/api/sync/events", ack).json()["results"][0]["result"] == "ACCEPTED"
    assert a.get(f"/api/rides/{rid}/stops").json()[0]["status"] == "ACKNOWLEDGED"


def test_voice_token_respects_admin_only_mode(ride_group):
    import jwt

    ride, admin, a, _ = ride_group
    tok = a.post(f"/api/rides/{ride['id']}/voice/token").json()
    claims = jwt.decode(tok["token"], options={"verify_signature": False})
    assert claims["video"]["canPublish"] is True and tok["push_to_talk"] is True

    assert a.put(f"/api/rides/{ride['id']}/voice/mode", {"voice_mode": "ADMIN_ONLY"}).status_code == 403
    r = admin.put(f"/api/rides/{ride['id']}/voice/mode", {"voice_mode": "ADMIN_ONLY"})
    assert r.status_code == 200
    tok = a.post(f"/api/rides/{ride['id']}/voice/token").json()
    claims = jwt.decode(tok["token"], options={"verify_signature": False})
    assert claims["video"].get("canPublish", False) is False and tok["can_publish"] is False
    admin_tok = admin.post(f"/api/rides/{ride['id']}/voice/token").json()
    assert admin_tok["can_publish"] is True
