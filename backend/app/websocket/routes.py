"""/ws/rides/{ride_id}

Protocol
  1. Client opens the socket and, within 5 s, sends {"type": "auth", "token": "<access token>"}.
     (Tokens are not put in the URL, so they don't end up in proxy logs.)
  2. Server replies with a PRESENCE snapshot and then streams RideEvent JSON.
  3. Client may send RideEvent-shaped messages: CLOCK_PING, LOCATION_UPDATED,
     STOP_REQUESTED, EMERGENCY_CREATED, DELIVERY_ACK, ADMIN_ANNOUNCEMENT (admin).
Close codes: 4401 unauthenticated, 4404 not a participant, 4403 removed/left, 4429 flooding.
"""

import asyncio
import logging
import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

from app.core.database import SessionLocal, utcnow
from app.core.errors import AppError
from app.core.permissions import require_participant, user_from_token
from app.models.enums import NotificationType
from app.schemas.events import EventType, RideEvent
from app.schemas.safety import AnnouncementCreate, EmergencyCreate, LocationIn, StopCreate
from app.services import emergency_service, location_service, stop_service
from app.services.audit import audit
from app.services.notification_service import mark_delivered, notify_ride
from app.websocket.events import ADMIN_ONLY_EVENTS, publish
from app.websocket.manager import manager

router = APIRouter()
log = logging.getLogger("ridewave.ws")

_MAX_MSGS_PER_10S = 120


class _ClientMessage(BaseModel):
    event_id: uuid.UUID | None = None
    event_type: EventType
    payload: dict = {}


def _authenticate(ride_id: uuid.UUID, token: str):
    with SessionLocal() as db:
        user = user_from_token(db, token)
        _, me = require_participant(db, ride_id, user)
        return user.id, me.is_admin, user.profile.display_name


def _handle(ride_id: uuid.UUID, user_id: uuid.UUID, msg: _ClientMessage) -> dict | None:
    """Runs in a worker thread with its own DB session."""
    with SessionLocal() as db:
        from app.models import User  # local import keeps module import order simple

        user = db.get(User, user_id)
        ride, me = require_participant(db, ride_id, user)
        if msg.event_type in ADMIN_ONLY_EVENTS and not me.is_admin:
            raise AppError("Only admins can send this event")
        p = msg.payload
        match msg.event_type:
            case EventType.LOCATION_UPDATED:
                location_service.record(db, ride, me, LocationIn(**p), source="ws")
            case EventType.STOP_REQUESTED:
                stop, _ = stop_service.create(db, ride, me, StopCreate(**{**p, "client_event_id": msg.event_id}))
                return {"stop_id": str(stop.id)}
            case EventType.EMERGENCY_CREATED:
                e, _ = emergency_service.create(db, ride, me, EmergencyCreate(**{**p, "client_event_id": msg.event_id}))
                return {"emergency_id": str(e.id)}
            case EventType.DELIVERY_ACK:
                ref = uuid.UUID(str(p["ref_id"]))
                if mark_delivered(db, user_id, ref):
                    publish(ride_id, EventType.DELIVERY_ACK, {"ref_id": str(ref), "user_id": str(user_id)},
                            sender_id=user_id)
            case EventType.ADMIN_ANNOUNCEMENT:
                a = AnnouncementCreate(**p)
                notify_ride(db, ride_id, NotificationType.ANNOUNCEMENT, "Announcement", a.text, exclude=user_id)
                audit(db, "ride.announce", actor_id=user_id, ride_id=ride_id)
                db.commit()
                publish(ride_id, EventType.ADMIN_ANNOUNCEMENT,
                        {"text": a.text, "speak": a.speak, "from": user.profile.display_name},
                        sender_id=user_id, event_id=msg.event_id)
            case _:
                raise AppError(f"{msg.event_type.value} cannot be sent by clients")
    return None


@router.websocket("/ws/rides/{ride_id}")
async def ride_socket(ws: WebSocket, ride_id: uuid.UUID):
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=5)
        if first.get("type") != "auth" or not isinstance(first.get("token"), str):
            raise AppError("auth required")
        user_id, _is_admin, name = await run_in_threadpool(_authenticate, ride_id, first["token"])
    except (TimeoutError, AppError, ValueError, KeyError, WebSocketDisconnect) as exc:
        code = 4404 if getattr(exc, "status_code", None) == 404 else 4401
        try:
            await ws.close(code=code, reason="unauthorized")
        except RuntimeError:
            pass
        return

    is_first = await manager.connect(ride_id, user_id, ws)
    await ws.send_json(
        RideEvent(event_type=EventType.PRESENCE, ride_id=ride_id,
                  payload={"online": [str(u) for u in manager.online_users(ride_id)], "you": str(user_id)},
                  delivery_status="DELIVERED").model_dump(mode="json")
    )
    if is_first:
        await manager.broadcast(
            RideEvent(event_type=EventType.RIDER_RECONNECTED, ride_id=ride_id, sender_id=user_id,
                      payload={"user_id": str(user_id), "display_name": name}),
            exclude_user=user_id,
        )

    window_start, count = time.monotonic(), 0
    try:
        while True:
            raw = await ws.receive_json()
            now = time.monotonic()
            if now - window_start > 10:
                window_start, count = now, 0
            count += 1
            if count > _MAX_MSGS_PER_10S:
                await ws.close(code=4429, reason="too many messages")
                break
            try:
                msg = _ClientMessage.model_validate(raw)
            except ValidationError as exc:
                await _send_error(ws, ride_id, None, f"invalid message: {exc.errors()[0]['msg']}")
                continue
            if msg.event_type == EventType.CLOCK_PING:
                await ws.send_json(
                    RideEvent(event_type=EventType.CLOCK_PONG, ride_id=ride_id,
                              payload={"client_time": msg.payload.get("client_time"),
                                       "server_time": utcnow().timestamp() * 1000}).model_dump(mode="json")
                )
                continue
            try:
                result = await run_in_threadpool(_handle, ride_id, user_id, msg)
                if msg.event_id:
                    await ws.send_json(
                        RideEvent(event_type=EventType.DELIVERY_ACK, ride_id=ride_id, delivery_status="DELIVERED",
                                  payload={"ref_event_id": str(msg.event_id), **(result or {})}).model_dump(mode="json")
                    )
            except AppError as exc:
                await _send_error(ws, ride_id, msg.event_id, exc.detail)
            except (ValidationError, ValueError, KeyError) as exc:
                await _send_error(ws, ride_id, msg.event_id, f"invalid payload: {exc}"[:200])
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass  # socket closed by kick()
    finally:
        if await manager.disconnect(ride_id, user_id, ws):
            await manager.broadcast(
                RideEvent(event_type=EventType.RIDER_DISCONNECTED, ride_id=ride_id, sender_id=user_id,
                          payload={"user_id": str(user_id), "display_name": name})
            )


async def _send_error(ws: WebSocket, ride_id: uuid.UUID, ref: uuid.UUID | None, detail: str) -> None:
    await ws.send_json(
        RideEvent(event_type=EventType.ERROR, ride_id=ride_id, delivery_status="FAILED",
                  payload={"ref_event_id": str(ref) if ref else None, "detail": detail}).model_dump(mode="json")
    )
