"""Authoritative group playback state.

The server never carries audio. It stores which track is playing, the
position at an anchor instant, and a monotonically increasing version. Each
phone plays its own copy (local file or its own Spotify) and seeks to
    position_ms + (server_now - anchor_at)
using a clock offset measured with CLOCK_PING.
"""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import as_utc, utcnow
from app.core.errors import Conflict
from app.models import MusicEvent, MusicSession, Ride, User
from app.models.enums import MusicAction, MusicSource, MusicState, RideStatus
from app.schemas.events import EventType
from app.schemas.music import MusicStatus, PauseRequest, PlayRequest, QueueUpdate, Track
from app.websocket.events import publish

_RESTART_THRESHOLD_MS = 3000

_EVENT = {
    MusicAction.PLAY: EventType.MUSIC_PLAY,
    MusicAction.PAUSE: EventType.MUSIC_PAUSE,
    MusicAction.NEXT: EventType.MUSIC_NEXT,
    MusicAction.PREVIOUS: EventType.MUSIC_PREV,
    MusicAction.QUEUE: EventType.MUSIC_QUEUE,
    MusicAction.ENABLE: EventType.MUSIC_ENABLED,
    MusicAction.DISABLE: EventType.MUSIC_ENABLED,
}


def get_session(db: Session, ride: Ride) -> MusicSession:
    s = db.scalar(select(MusicSession).where(MusicSession.ride_id == ride.id))
    if s is None:
        s = MusicSession(ride_id=ride.id, enabled=ride.music_enabled, queue=[], anchor_at=utcnow())
        db.add(s)
        db.commit()
    return s


def _current(s: MusicSession) -> Track | None:
    if 0 <= s.queue_index < len(s.queue):
        return Track.model_validate(s.queue[s.queue_index])
    return None


def live_position(s: MusicSession, now=None) -> int:
    if s.state != MusicState.PLAYING:
        return s.position_ms
    now = now or utcnow()
    elapsed = int((now - as_utc(s.anchor_at)).total_seconds() * 1000)
    pos = s.position_ms + max(elapsed, 0)
    cur = _current(s)
    return min(pos, cur.duration_ms) if cur and cur.duration_ms else pos


def status(s: MusicSession) -> MusicStatus:
    return MusicStatus(
        ride_id=s.ride_id,
        enabled=s.enabled,
        source=s.source,
        state=s.state,
        queue=[Track.model_validate(t) for t in s.queue],
        queue_index=s.queue_index,
        current=_current(s),
        position_ms=s.position_ms,
        anchor_at=s.anchor_at,
        server_time=utcnow(),
        version=s.version,
    )


def _commit(db: Session, s: MusicSession, actor: User, action: MusicAction, payload: dict | None = None):
    s.version += 1
    s.updated_by = actor.id
    cur = _current(s)
    db.add(MusicEvent(session_id=s.id, action=action, actor_id=actor.id, version=s.version, payload=payload or {},
                      track_ref=cur.ref if cur else None))
    db.commit()
    st = status(s)
    publish(s.ride_id, _EVENT[action], st.model_dump(mode="json"), sender_id=actor.id)
    return st


def _guard(ride: Ride, s: MusicSession) -> None:
    if ride.status in (RideStatus.ENDED, RideStatus.CANCELLED):
        raise Conflict("Ride has ended")
    if not s.enabled:
        raise Conflict("Group music is disabled for this ride")


def set_queue(db: Session, ride: Ride, actor: User, data: QueueUpdate) -> MusicStatus:
    s = get_session(db, ride)
    _guard(ride, s)
    s.source = data.source
    s.queue = [t.model_dump(mode="json") for t in data.tracks]
    s.queue_index = data.start_index
    s.state, s.position_ms, s.anchor_at = MusicState.PAUSED, 0, utcnow()
    return _commit(db, s, actor, MusicAction.QUEUE, {"count": len(data.tracks)})


def play(db: Session, ride: Ride, actor: User, data: PlayRequest) -> MusicStatus:
    s = get_session(db, ride)
    _guard(ride, s)
    if not s.queue:
        raise Conflict("Queue is empty — pick a playlist or song first")
    if data.queue_index is not None:
        if data.queue_index >= len(s.queue):
            raise Conflict("Track index out of range")
        if data.queue_index != s.queue_index:
            s.position_ms = 0
        s.queue_index = data.queue_index
    start_pos = data.position_ms if data.position_ms is not None else live_position(s)
    s.state = MusicState.PLAYING
    s.position_ms = start_pos
    s.anchor_at = utcnow() + timedelta(milliseconds=data.lead_ms)
    return _commit(db, s, actor, MusicAction.PLAY)


def pause(db: Session, ride: Ride, actor: User, data: PauseRequest) -> MusicStatus:
    s = get_session(db, ride)
    _guard(ride, s)
    pos = data.position_ms if data.position_ms is not None else live_position(s)
    s.state, s.position_ms, s.anchor_at = MusicState.PAUSED, max(pos, 0), utcnow()
    return _commit(db, s, actor, MusicAction.PAUSE)


def skip(db: Session, ride: Ride, actor: User, forward: bool, lead_ms: int = 1500) -> MusicStatus:
    s = get_session(db, ride)
    _guard(ride, s)
    if not s.queue:
        raise Conflict("Queue is empty")
    if forward:
        if s.queue_index + 1 >= len(s.queue):
            raise Conflict("Already at the last track")
        s.queue_index += 1
    elif live_position(s) <= _RESTART_THRESHOLD_MS:
        s.queue_index = max(s.queue_index - 1, 0)
    was_playing = s.state == MusicState.PLAYING
    s.position_ms = 0
    s.anchor_at = utcnow() + timedelta(milliseconds=lead_ms if was_playing else 0)
    return _commit(db, s, actor, MusicAction.NEXT if forward else MusicAction.PREVIOUS)


def set_enabled(db: Session, ride: Ride, actor: User, enabled: bool) -> MusicStatus:
    s = get_session(db, ride)
    s.enabled = enabled
    ride.music_enabled = enabled
    if not enabled and s.state == MusicState.PLAYING:
        s.position_ms, s.state, s.anchor_at = live_position(s), MusicState.PAUSED, utcnow()
    return _commit(db, s, actor, MusicAction.ENABLE if enabled else MusicAction.DISABLE)


__all__ = ["MusicSource", "get_session", "live_position", "pause", "play", "set_enabled", "set_queue", "skip",
           "status"]
