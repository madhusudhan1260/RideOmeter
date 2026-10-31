import hashlib


def _local(title: str, ms: int = 200_000):
    return {"source": "LOCAL", "ref": hashlib.sha256(title.encode()).hexdigest(), "title": title,
            "artist": "Test", "duration_ms": ms}


def test_admin_controls_group_playback(ride_group):
    ride, admin, a, _ = ride_group
    base = f"/api/rides/{ride['id']}/music"
    assert admin.post(f"{base}/play").status_code == 409  # empty queue

    q = admin.put(f"{base}/queue", {"source": "LOCAL", "tracks": [_local("One"), _local("Two"), _local("Three")]})
    assert q.status_code == 200 and q.json()["state"] == "PAUSED"

    play = admin.post(f"{base}/play", {"lead_ms": 0}).json()
    assert play["state"] == "PLAYING" and play["current"]["title"] == "One"
    v = play["version"]

    status = a.get(f"{base}/status").json()  # members can read
    assert status["version"] == v and status["queue_index"] == 0

    nxt = admin.post(f"{base}/next").json()
    assert nxt["current"]["title"] == "Two" and nxt["position_ms"] == 0 and nxt["version"] == v + 1

    paused = admin.post(f"{base}/pause", {"position_ms": 5000}).json()
    assert paused["state"] == "PAUSED" and paused["position_ms"] == 5000

    # Previous after >3 s restarts the same track.
    prev = admin.post(f"{base}/previous").json()
    assert prev["current"]["title"] == "Two" and prev["position_ms"] == 0
    prev = admin.post(f"{base}/previous").json()
    assert prev["current"]["title"] == "One"


def test_member_cannot_control_music(ride_group):
    ride, _, a, _ = ride_group
    base = f"/api/rides/{ride['id']}/music"
    assert a.put(f"{base}/queue", {"source": "LOCAL", "tracks": [_local("X")]}).status_code == 403
    assert a.post(f"{base}/play").status_code == 403
    assert a.post(f"{base}/pause").status_code == 403
    assert a.post(f"{base}/next").status_code == 403


def test_spotify_refs_validated(ride_group):
    ride, admin, *_ = ride_group
    base = f"/api/rides/{ride['id']}/music"
    bad = admin.put(f"{base}/queue", {"source": "SPOTIFY", "tracks": [
        {"source": "SPOTIFY", "ref": "https://evil.example/track", "title": "x", "duration_ms": 1}]})
    assert bad.status_code == 422
    ok = admin.put(f"{base}/queue", {"source": "SPOTIFY", "tracks": [
        {"source": "SPOTIFY", "ref": "spotify:track:4uLU6hMCjMI75M1A2tKUQC", "title": "Song", "duration_ms": 1000}]})
    assert ok.status_code == 200
    mixed = admin.put(f"{base}/queue", {"source": "SPOTIFY", "tracks": [_local("x")]})
    assert mixed.status_code == 422


def test_disable_group_music(ride_group):
    ride, admin, *_ = ride_group
    base = f"/api/rides/{ride['id']}/music"
    admin.put(f"{base}/queue", {"source": "LOCAL", "tracks": [_local("One")]})
    admin.post(f"{base}/play")
    off = admin.put(f"{base}/enabled", {"enabled": False}).json()
    assert off["enabled"] is False and off["state"] == "PAUSED"
    assert admin.post(f"{base}/play").status_code == 409


def test_live_position_math():
    from datetime import timedelta

    from app.core.database import utcnow
    from app.models import MusicSession
    from app.models.enums import MusicState
    from app.services.music_service import live_position

    now = utcnow()
    s = MusicSession(state=MusicState.PLAYING, position_ms=10_000, anchor_at=now - timedelta(seconds=5),
                     queue=[_local("One", 12_000)], queue_index=0)
    assert live_position(s, now) == 12_000  # clamped to duration
    s.queue = [_local("One", 60_000)]
    assert live_position(s, now) == 15_000
    s.anchor_at = now + timedelta(seconds=2)  # scheduled start in the future
    assert live_position(s, now) == 10_000
