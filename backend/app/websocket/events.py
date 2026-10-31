"""Bridge from (sync) service code to the async WebSocket manager.

Services run in FastAPI's worker threads. `publish` hands the coroutine to the
event loop that owns the sockets: via anyio's thread portal when called from a
worker thread, or as a task when already on the loop.
"""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable

import anyio.from_thread

from app.schemas.events import EventType, RideEvent
from app.websocket.manager import manager

log = logging.getLogger("ridewave.events")

# Event types only an admin / co-admin may originate.
ADMIN_ONLY_EVENTS = frozenset(
    {
        EventType.RIDE_STARTED,
        EventType.RIDE_ENDED,
        EventType.RIDE_UPDATED,
        EventType.MUSIC_PLAY,
        EventType.MUSIC_PAUSE,
        EventType.MUSIC_NEXT,
        EventType.MUSIC_PREV,
        EventType.MUSIC_QUEUE,
        EventType.MUSIC_ENABLED,
        EventType.STOP_ACKNOWLEDGED,
        EventType.ADMIN_ANNOUNCEMENT,
        EventType.VOICE_MODE_CHANGED,
        EventType.RIDER_REMOVED,
        EventType.RIDER_ROLE_CHANGED,
    }
)


def _run(fn: Callable[..., Awaitable], *args) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        loop.create_task(fn(*args))
        return
    try:
        anyio.from_thread.run(fn, *args)
    except RuntimeError:
        # Not inside a server (e.g. a CLI script) — nobody to deliver to.
        log.debug("no event loop available; skipped %s", getattr(fn, "__name__", fn))


def publish(
    ride_id: uuid.UUID,
    event_type: EventType,
    payload: dict | None = None,
    sender_id: uuid.UUID | None = None,
    exclude_user: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
) -> RideEvent:
    event = RideEvent(
        event_type=event_type,
        ride_id=ride_id,
        sender_id=sender_id,
        payload=payload or {},
        **({"event_id": event_id} if event_id else {}),
    )
    _run(manager.broadcast, event, exclude_user)
    return event


def kick(ride_id: uuid.UUID, user_id: uuid.UUID, reason: str) -> None:
    _run(manager.kick, ride_id, user_id, reason)
