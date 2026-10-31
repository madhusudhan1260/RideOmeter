"""Apply events captured offline (SQLite outbox on the phone) once internet returns.

Rules:
* Idempotent on event_id — re-uploading a batch is safe.
* A device may only upload events it authored (sender_id == uploader).
  Relayed copies from other riders are rejected; each rider's phone uploads
  its own outbox, so nothing is lost, and nobody can forge another rider's SOS.
* Each event is re-validated with the same role checks as the live API.
* Conflicts: terminal stop states win over non-terminal; otherwise the server's
  current state stands if the transition is no longer valid.
"""

import logging
import uuid
from datetime import timedelta

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import as_utc, utcnow
from app.core.errors import AppError
from app.core.permissions import find_participant, get_ride
from app.models import OfflineSyncEvent, User
from app.models.enums import NotificationType, ParticipantStatus, SyncResult
from app.schemas.events import EventType, SyncBatch, SyncBatchResult, SyncEventIn, SyncEventResult
from app.schemas.safety import AnnouncementCreate, EmergencyCreate, LocationIn, StopCreate
from app.services import emergency_service, location_service, stop_service
from app.services.notification_service import notify_ride
from app.websocket.events import ADMIN_ONLY_EVENTS, publish

log = logging.getLogger("ridewave.sync")

_MAX_FUTURE = timedelta(minutes=5)
_MAX_AGE = timedelta(days=7)

SUPPORTED = {
    EventType.STOP_REQUESTED,
    EventType.STOP_ACKNOWLEDGED,
    EventType.STOP_UPDATED,
    EventType.EMERGENCY_CREATED,
    EventType.EMERGENCY_ACKNOWLEDGED,
    EventType.LOCATION_UPDATED,
    EventType.ADMIN_ANNOUNCEMENT,
}


def _apply(db: Session, user: User, ev: SyncEventIn) -> None:
    ride = get_ride(db, ev.ride_id)
    me = find_participant(db, ride.id, user.id)
    if me is None or me.status not in (ParticipantStatus.ACTIVE, ParticipantStatus.LEFT):
        raise AppError("Not a participant of this ride")
    if ev.event_type in ADMIN_ONLY_EVENTS and not me.is_admin:
        raise AppError("Admin-only event")
    p = ev.payload

    if ev.event_type == EventType.STOP_REQUESTED:
        data = StopCreate(**{k: p.get(k) for k in ("type", "note", "lat", "lng")}, client_event_id=ev.event_id)
        stop_service.create(db, ride, me, data, created_at=ev.timestamp, transport="sync")
    elif ev.event_type in (EventType.STOP_ACKNOWLEDGED, EventType.STOP_UPDATED):
        action = "acknowledge" if ev.event_type == EventType.STOP_ACKNOWLEDGED else p.get("action")
        if action not in ("acknowledge", "approve", "reject", "complete"):
            raise AppError("Unknown stop action")
        stop_service.act(db, uuid.UUID(str(p["stop_id"])), user.id, action, at=ev.timestamp)
    elif ev.event_type == EventType.EMERGENCY_CREATED:
        data = EmergencyCreate(
            **{k: p.get(k) for k in ("type", "message", "lat", "lng", "location_recorded_at")},
            client_event_id=ev.event_id,
        )
        emergency_service.create(db, ride, me, data, created_at=ev.timestamp, transport="sync")
    elif ev.event_type == EventType.EMERGENCY_ACKNOWLEDGED:
        emergency_service.acknowledge(db, uuid.UUID(str(p["emergency_id"])), user.id, at=ev.timestamp)
    elif ev.event_type == EventType.LOCATION_UPDATED:
        loc = LocationIn(**{**p, "recorded_at": p.get("recorded_at") or ev.timestamp})
        location_service.record(db, ride, me, loc, source="sync", broadcast=False)
    elif ev.event_type == EventType.ADMIN_ANNOUNCEMENT:
        a = AnnouncementCreate(**p)
        notify_ride(db, ride.id, NotificationType.ANNOUNCEMENT, "Announcement", a.text, exclude=user.id)
        db.commit()
        publish(ride.id, EventType.ADMIN_ANNOUNCEMENT, {"text": a.text, "speak": False, "offline": True},
                sender_id=user.id, event_id=ev.event_id)


def apply_batch(db: Session, user: User, batch: SyncBatch) -> SyncBatchResult:
    now = utcnow()
    results: list[SyncEventResult] = []
    for ev in sorted(batch.events, key=lambda e: e.timestamp):
        if db.scalar(select(OfflineSyncEvent.id).where(OfflineSyncEvent.event_id == ev.event_id)):
            results.append(SyncEventResult(event_id=ev.event_id, result=SyncResult.DUPLICATE))
            continue

        reason = None
        ts = as_utc(ev.timestamp)
        if ev.sender_id != user.id:
            reason = "Events must be uploaded by the rider who created them"
        elif ev.event_type not in SUPPORTED:
            reason = f"{ev.event_type.value} is not accepted from offline sync"
        elif ts > now + _MAX_FUTURE:
            reason = "Timestamp is in the future"
        elif ts < now - _MAX_AGE:
            reason = "Event is too old"

        if reason is None:
            try:
                _apply(db, user, ev)
            except (AppError, ValidationError, KeyError, ValueError) as exc:
                db.rollback()
                reason = getattr(exc, "detail", None) or str(exc)[:200]

        # The ride must exist for the FK; unknown rides are reported, not stored.
        result = SyncResult.REJECTED if reason else SyncResult.ACCEPTED
        try:
            get_ride(db, ev.ride_id)
            db.add(OfflineSyncEvent(event_id=ev.event_id, ride_id=ev.ride_id, sender_id=ev.sender_id,
                                    uploader_id=user.id, event_type=ev.event_type.value, payload=ev.payload,
                                    client_timestamp=ts, result=result, reason=reason))
            db.commit()
        except AppError:
            db.rollback()
        except Exception:  # noqa: BLE001 — e.g. sender_id of an unknown user
            db.rollback()
            log.exception("could not record sync event %s", ev.event_id)
        results.append(SyncEventResult(event_id=ev.event_id, result=result, reason=reason))
    return SyncBatchResult(results=results, server_time=utcnow())
