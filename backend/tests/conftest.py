import os
import tempfile
import uuid
from datetime import UTC, datetime, timedelta

_tmp = tempfile.mkdtemp(prefix="ridewave-test-")
os.environ["RW_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["RW_MEDIA_DIR"] = f"{_tmp}/media"
os.environ["RW_EXPOSE_RESET_TOKEN"] = "true"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.database import Base, engine  # noqa: E402
from app.core.rate_limit import limiter  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "ride2026safe"


@pytest.fixture(autouse=True)
def _fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    limiter.reset()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class Rider:
    def __init__(self, client: TestClient, name: str):
        self.client = client
        self.username = f"{name.lower()}_{uuid.uuid4().hex[:6]}"
        self.email = f"{self.username}@example.com"
        r = client.post("/api/auth/register", json={
            "email": self.email, "username": self.username, "password": PASSWORD, "display_name": name})
        assert r.status_code == 201, r.text
        self.tokens = r.json()
        self.id = client.get("/api/users/me", headers=self.headers).json()["id"]

    @property
    def headers(self):
        return {"Authorization": f"Bearer {self.tokens['access_token']}"}

    def get(self, url, **kw):
        return self.client.get(url, headers=self.headers, **kw)

    def post(self, url, json=None, **kw):
        return self.client.post(url, json=json, headers=self.headers, **kw)

    def put(self, url, json=None, **kw):
        return self.client.put(url, json=json, headers=self.headers, **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers=self.headers, **kw)


@pytest.fixture
def make_rider(client):
    return lambda name="Rider": Rider(client, name)


def ride_payload(**over):
    body = {
        "name": "Sunrise to Nandi Hills",
        "start": {"name": "Hebbal Flyover", "lat": 13.04, "lng": 77.59},
        "destination": {"name": "Nandi Hills", "lat": 13.37, "lng": 77.68},
        "scheduled_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "max_participants": 5,
    }
    body.update(over)
    return body


@pytest.fixture
def ride_group(make_rider):
    """Admin + two members in an ACTIVE ride."""
    admin, a, b = make_rider("Captain"), make_rider("Arjun"), make_rider("Bela")
    ride = admin.post("/api/rides", ride_payload()).json()
    for m in (a, b):
        assert m.post("/api/rides/join", {"code": ride["join_code"]}).status_code == 200
    assert admin.post(f"/api/rides/{ride['id']}/start").status_code == 200
    return ride, admin, a, b
