from tests.conftest import PASSWORD


def test_register_returns_tokens_and_hashes_password(client, make_rider):
    from app.core.database import SessionLocal
    from app.models import User

    r = make_rider("Asha")
    assert r.tokens["token_type"] == "bearer"
    with SessionLocal() as db:
        u = db.get(User, __import__("uuid").UUID(r.id))
        assert u.password_hash.startswith("$argon2id$")
        assert PASSWORD not in u.password_hash


def test_duplicate_registration_conflicts(client, make_rider):
    r = make_rider("Asha")
    resp = client.post("/api/auth/register", json={
        "email": r.email.upper(), "username": "other_name", "password": PASSWORD, "display_name": "x"})
    assert resp.status_code == 409


def test_weak_password_rejected(client):
    resp = client.post("/api/auth/register", json={
        "email": "a@example.com", "username": "abc", "password": "password", "display_name": "A"})
    assert resp.status_code == 422


def test_login_with_email_or_username(client, make_rider):
    r = make_rider("Asha")
    for ident in (r.email, r.username, r.username.upper()):
        resp = client.post("/api/auth/login", json={"identifier": ident, "password": PASSWORD})
        assert resp.status_code == 200, ident
    bad = client.post("/api/auth/login", json={"identifier": r.email, "password": "wrong-pass1"})
    assert bad.status_code == 401
    unknown = client.post("/api/auth/login", json={"identifier": "ghost@example.com", "password": PASSWORD})
    assert unknown.status_code == 401
    assert bad.json()["detail"] == unknown.json()["detail"]


def test_protected_routes_require_token(client):
    assert client.get("/api/users/me").status_code == 401
    assert client.get("/api/users/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_refresh_rotates_and_detects_reuse(client, make_rider):
    r = make_rider("Asha")
    old = r.tokens["refresh_token"]
    first = client.post("/api/auth/refresh", json={"refresh_token": old})
    assert first.status_code == 200
    new = first.json()["refresh_token"]
    assert new != old
    # Replaying the rotated token revokes the whole family, including the new one.
    assert client.post("/api/auth/refresh", json={"refresh_token": old}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": new}).status_code == 401


def test_logout_revokes_refresh_token(client, make_rider):
    r = make_rider("Asha")
    assert r.post("/api/auth/logout", {"refresh_token": r.tokens["refresh_token"]}).status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": r.tokens["refresh_token"]}).status_code == 401


def test_password_reset_flow(client, make_rider):
    r = make_rider("Asha")
    resp = client.post("/api/auth/forgot-password", json={"email": r.email})
    token = resp.json()["dev_reset_token"]
    assert token
    # Unknown e-mail gets the same message and no token.
    other = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"}).json()
    assert other["detail"] == resp.json()["detail"] and other["dev_reset_token"] is None

    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "newpass2026"}).status_code == 200
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "again2026x"}).status_code == 401
    assert client.post("/api/auth/login", json={"identifier": r.email, "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/login", json={"identifier": r.email, "password": "newpass2026"}).status_code == 200
    # Old sessions are signed out.
    assert client.post("/api/auth/refresh", json={"refresh_token": r.tokens["refresh_token"]}).status_code == 401


def test_login_rate_limited(client, make_rider):
    r = make_rider("Asha")
    codes = [client.post("/api/auth/login", json={"identifier": r.email, "password": "bad-pass-1"}).status_code
             for _ in range(12)]
    assert 429 in codes


def test_profile_update_and_privacy(client, make_rider):
    a, stranger = make_rider("Asha"), make_rider("Stranger")
    resp = a.put("/api/users/me", {
        "phone": "+91 98765 43210",
        "emergency_contact_name": "Ravi",
        "emergency_contact_phone": "+91 99999 00000",
        "motorcycle": {"make": "Royal Enfield", "model": "Himalayan 450", "year": 2025},
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["motorcycles"][0]["model"] == "Himalayan 450"
    assert body["profile"]["phone"] == "+91 98765 43210"
    # Strangers who share no ride can't look each other up.
    assert stranger.get(f"/api/users/{a.id}").status_code == 404


def test_avatar_upload_validates_content(client, make_rider):
    a = make_rider("Asha")
    bad = a.post("/api/users/me/avatar", files={"file": ("x.png", b"not an image", "image/png")})
    assert bad.status_code == 400
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    ok = a.post("/api/users/me/avatar", files={"file": ("x.png", png, "image/png")})
    assert ok.status_code == 200
    assert ok.json()["profile"]["avatar_url"].endswith(".png")
