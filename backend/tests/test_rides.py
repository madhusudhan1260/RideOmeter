from datetime import UTC, datetime, timedelta

from tests.conftest import ride_payload


def test_create_ride_makes_creator_admin(make_rider):
    admin = make_rider("Captain")
    r = admin.post("/api/rides", ride_payload())
    assert r.status_code == 201
    ride = r.json()
    assert ride["my_role"] == "ADMIN"
    assert len(ride["join_code"]) == 8
    assert ride["invite_link"].endswith(ride["join_code"])
    assert ride["participants"][0]["user_id"] == admin.id
    assert "offline_key" not in ride


def test_past_ride_rejected(make_rider):
    admin = make_rider("Captain")
    past = (datetime.now(UTC) - timedelta(days=2)).isoformat()
    assert admin.post("/api/rides", ride_payload(scheduled_at=past)).status_code == 400


def test_join_by_code_and_member_view(make_rider):
    admin, m = make_rider("Captain"), make_rider("Arjun")
    ride = admin.post("/api/rides", ride_payload()).json()
    joined = m.post("/api/rides/join", {"code": ride["join_code"].lower()})
    assert joined.status_code == 200
    body = joined.json()
    assert body["my_role"] == "MEMBER"
    assert body["join_code"] is None  # members don't see the code
    assert body["participant_count"] == 2
    # Joining twice is idempotent.
    assert m.post("/api/rides/join", {"code": ride["join_code"]}).json()["participant_count"] == 2


def test_invalid_code_and_private_ride_hidden(make_rider):
    admin, outsider = make_rider("Captain"), make_rider("Out")
    ride = admin.post("/api/rides", ride_payload()).json()
    assert outsider.post("/api/rides/join", {"code": "ZZZZZZZZ"}).status_code == 404
    assert outsider.get(f"/api/rides/{ride['id']}").status_code == 404
    assert outsider.get(f"/api/rides/{ride['id']}/locations").status_code == 404


def test_ride_full(make_rider):
    admin = make_rider("Captain")
    ride = admin.post("/api/rides", ride_payload(max_participants=2)).json()
    assert make_rider("A").post("/api/rides/join", {"code": ride["join_code"]}).status_code == 200
    assert make_rider("B").post("/api/rides/join", {"code": ride["join_code"]}).status_code == 409


def test_member_cannot_run_admin_actions(ride_group):
    ride, admin, a, b = ride_group
    rid = ride["id"]
    assert a.post(f"/api/rides/{rid}/end").status_code == 403
    assert a.delete(f"/api/rides/{rid}/participants/{b.id}").status_code == 403
    assert a.post(f"/api/rides/{rid}/announcements", {"text": "hi"}).status_code == 403
    assert a.get(f"/api/rides/{rid}/qr.svg").status_code == 403
    assert a.put(f"/api/rides/{rid}/participants/{b.id}/role", {"role": "CO_ADMIN"}).status_code == 403


def test_remove_rider_blocks_rejoin(ride_group):
    ride, admin, a, _ = ride_group
    assert admin.delete(f"/api/rides/{ride['id']}/participants/{a.id}").status_code == 200
    assert a.get(f"/api/rides/{ride['id']}").status_code == 404
    assert a.post("/api/rides/join", {"code": ride["join_code"]}).status_code == 403


def test_admin_cannot_leave_without_co_admin(ride_group):
    ride, admin, a, _ = ride_group
    rid = ride["id"]
    assert admin.post(f"/api/rides/{rid}/leave").status_code == 409
    assert admin.put(f"/api/rides/{rid}/participants/{a.id}/role", {"role": "CO_ADMIN"}).status_code == 200
    assert admin.post(f"/api/rides/{rid}/leave").status_code == 200
    detail = a.get(f"/api/rides/{rid}").json()
    assert detail["my_role"] == "ADMIN"


def test_member_leave_and_rejoin(ride_group):
    ride, _, a, _ = ride_group
    assert a.post(f"/api/rides/{ride['id']}/leave").status_code == 200
    assert a.post("/api/rides/join", {"code": ride["join_code"]}).status_code == 200


def test_start_end_lifecycle(make_rider):
    admin = make_rider("Captain")
    ride = admin.post("/api/rides", ride_payload()).json()
    rid = ride["id"]
    assert admin.post(f"/api/rides/{rid}/start").json()["status"] == "ACTIVE"
    assert admin.post(f"/api/rides/{rid}/start").status_code == 409
    assert admin.post(f"/api/rides/{rid}/end").json()["status"] == "ENDED"
    assert make_rider("Late").post("/api/rides/join", {"code": ride["join_code"]}).status_code == 409


def test_approval_flow(make_rider):
    admin, m = make_rider("Captain"), make_rider("Arjun")
    ride = admin.post("/api/rides", ride_payload(requires_approval=True)).json()
    r = m.post("/api/rides/join", {"code": ride["join_code"]})
    assert r.json()["my_status"] == "PENDING"
    assert m.get(f"/api/rides/{ride['id']}/locations").status_code == 404
    pending = admin.get(f"/api/rides/{ride['id']}").json()["participants"]
    assert any(p["status"] == "PENDING" for p in pending)
    assert admin.post(f"/api/rides/{ride['id']}/participants/{m.id}/approve").status_code == 200
    assert m.get(f"/api/rides/{ride['id']}").json()["my_status"] == "ACTIVE"


def test_invitation_link_max_uses(make_rider):
    admin = make_rider("Captain")
    ride = admin.post("/api/rides", ride_payload()).json()
    inv = admin.post(f"/api/rides/{ride['id']}/invitations", {"max_uses": 1}).json()
    assert inv["link"].endswith(inv["token"])
    assert make_rider("A").post(f"/api/rides/{ride['id']}/join", {"code": inv["token"]}).status_code == 200
    assert make_rider("B").post(f"/api/rides/{ride['id']}/join", {"code": inv["token"]}).status_code == 400


def test_qr_and_offline_credentials(ride_group, make_rider):
    ride, admin, a, _ = ride_group
    qr = admin.get(f"/api/rides/{ride['id']}/qr.svg")
    assert qr.status_code == 200 and qr.headers["content-type"].startswith("image/svg+xml")
    creds = a.get(f"/api/rides/{ride['id']}/offline-credentials").json()
    assert len(creds["offline_key"]) == 64
    assert len(creds["participants"]) == 3
    assert make_rider("Out").get(f"/api/rides/{ride['id']}/offline-credentials").status_code == 404


def test_list_scopes(ride_group):
    ride, admin, *_ = ride_group
    assert [r["id"] for r in admin.get("/api/rides?scope=active").json()] == [ride["id"]]
    assert admin.get("/api/rides?scope=recent").json() == []
    admin.post(f"/api/rides/{ride['id']}/end")
    assert [r["id"] for r in admin.get("/api/rides?scope=recent").json()] == [ride["id"]]


def test_shared_ride_makes_profile_visible(ride_group):
    _, admin, a, _ = ride_group
    body = a.get(f"/api/users/{admin.id}").json()
    assert body["display_name"] == "Captain"
    assert "email" not in body and "phone" not in body
