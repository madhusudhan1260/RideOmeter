import uuid
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import as_utc, utcnow
from app.core.errors import Conflict, Forbidden, NotFound
from app.core.permissions import find_participant
from app.models import Ride, RideParticipant, StopRequest
from app.models.enums import NotificationType, ParticipantStatus, RideStatus, StopStatus, StopType
from app.schemas.events import EventType
from app.schemas.safety import StopCreate, StopOut
from app.services.audit import audit
from app.services.notification_service import notify_ride
from app.websocket.events import publish

LABELS = {
    StopType.PETROL: "Petrol stop",
    StopType.FOOD: "Food stop",
    StopType.TEA_COFFEE: "Tea or coffee stop",
    StopType.RESTROOM: "Restroom stop",
    StopType.REST: "Rest stop",
    StopType.BREAKDOWN: "Bike breakdown",
    StopType.EMERGENCY: "Emergency assistance",
    StopType.CUSTOM: "Stop",
}

_EXPIRING = (StopStatus.OPEN, StopStatus.ACKNOWLEDGED)
_LIVE = (StopStatus.OPEN, StopStatus.ACKNOWLEDGED, StopStatus.APPROVED)

# action -> (allowed from-states, to-state)
_TRANSITIONS = {
    "acknowledge": ((StopStatus.OPEN,), StopStatus.ACKNOWLEDGED),
    "approve": ((StopStatus.OPEN, StopStatus.ACKNOWLEDGED), StopStatus.APPROVED),
    "reject": (_LIVE, StopStatus.REJECTED),
    "complete": (_LIVE, StopStatus.COMPLETED),
}


def announcement(stop_type: StopType, name: str, note: str | None = None) -> str:
    if stop_type == StopType.BREAKDOWN:
        return f"Bike breakdown reported by {name}."
    if stop_type == StopType.CUSTOM:
        return f"{name} requests a stop: {note}."
    return f"{LABELS[stop_type]} requested by {name}."


def to_out(stop: StopRequest) -> StopOut:
    name = stop.requester.profile.display_name
    return StopOut(
        id=stop.id,
        ride_id=stop.ride_id,
        requester_id=stop.requester_id,
        requester_name=name,
        type=stop.type,
        note=stop.note,
        status=stop.status,
        lat=stop.lat,
        lng=stop.lng,
        created_at=stop.created_at,
        expires_at=stop.expires_at,
        handled_by=stop.handled_by,
        handled_at=stop.handled_at,
        announcement=announcement(stop.type, name, stop.note),
    )


def expire_stale(db: Session, ride_id: uuid.UUID) -> None:
    db.execute(
        update(StopRequest)
        .where(StopRequest.ride_id == ride_id, StopRequest.status.in_(_EXPIRING), StopRequest.expires_at <= utcnow())
        .values(status=StopStatus.EXPIRED)
    )


def create(
    db: Session, ride: Ride, me: RideParticipant, data: StopCreate, *, created_at=None, transport: str = "ws"
) -> tuple[StopRequest, bool]:
    """Returns (stop, created). Re-sending the same client_event_id is idempotent."""
    if data.client_event_id:
        existing = db.scalar(select(StopRequest).where(StopRequest.client_event_id == data.client_event_id))
        if existing is not None:
            if existing.ride_id != ride.id or existing.requester_id != me.user_id:
                raise Conflict("Event id already used")
            return existing, False
    # Offline-synced requests from a ride that has since ended are kept as history.
    if ride.status != RideStatus.ACTIVE and not (created_at and ride.status == RideStatus.ENDED):
        raise Conflict("Stop requests are only available during an active ride")

    expire_stale(db, ride.id)
    dup = db.scalar(
        select(StopRequest).where(
            StopRequest.ride_id == ride.id,
            StopRequest.requester_id == me.user_id,
            StopRequest.type == data.type,
            StopRequest.status.in_(_LIVE),
        )
    )
    if dup is not None:
        raise Conflict("You already have an open request of this type", extra={"stop_id": str(dup.id)})

    created = as_utc(created_at) or utcnow()
    stop = StopRequest(
        ride_id=ride.id,
        requester_id=me.user_id,
        type=data.type,
        note=data.note,
        lat=data.lat,
        lng=data.lng,
        created_at=created,
        expires_at=created + timedelta(minutes=get_settings().stop_request_ttl_minutes),
        client_event_id=data.client_event_id,
    )
    if stop.expires_at <= utcnow():
        stop.status = StopStatus.EXPIRED  # arrived late through offline sync: history only
    db.add(stop)
    db.flush()
    db.refresh(stop)
    out = to_out(stop)
    if stop.status == StopStatus.OPEN:
        notify_ride(db, ride.id, NotificationType.STOP_REQUESTED, LABELS[data.type], out.announcement,
                    ref_id=stop.id, exclude=me.user_id, data={"type": data.type.value})
    audit(db, "stop.create", actor_id=me.user_id, ride_id=ride.id, stop_id=stop.id, type=data.type.value,
          transport=transport)
    db.commit()
    if stop.status == StopStatus.OPEN:
        publish(ride.id, EventType.STOP_REQUESTED, out.model_dump(mode="json"), sender_id=me.user_id,
                event_id=data.client_event_id)
    return stop, True


def list_for_ride(db: Session, ride_id: uuid.UUID, include_closed: bool) -> list[StopOut]:
    expire_stale(db, ride_id)
    db.commit()
    q = select(StopRequest).where(StopRequest.ride_id == ride_id)
    if not include_closed:
        q = q.where(StopRequest.status.in_(_LIVE))
    return [to_out(s) for s in db.scalars(q.order_by(StopRequest.created_at.desc()).limit(200))]


def act(db: Session, stop_id: uuid.UUID, user_id: uuid.UUID, action: str, *, at=None) -> StopRequest:
    stop = db.get(StopRequest, stop_id)
    p = find_participant(db, stop.ride_id, user_id) if stop else None
    if stop is None or p is None or p.status != ParticipantStatus.ACTIVE:
        raise NotFound("Stop request not found")
    own_withdraw = action == "complete" and stop.requester_id == user_id
    if not (p.is_admin or own_withdraw):
        raise Forbidden("Only the ride admin or co-admin can do this")
    expire_stale(db, stop.ride_id)
    db.refresh(stop)
    allowed, target = _TRANSITIONS[action]
    if stop.status == target:
        return stop
    if stop.status not in allowed:
        raise Conflict(f"Request is already {stop.status.value.lower()}")
    stop.status, stop.handled_by, stop.handled_at = target, user_id, as_utc(at) or utcnow()
    audit(db, f"stop.{action}", actor_id=user_id, ride_id=stop.ride_id, stop_id=stop.id)
    db.commit()
    event = EventType.STOP_ACKNOWLEDGED if action == "acknowledge" else EventType.STOP_UPDATED
    publish(stop.ride_id, event, to_out(stop).model_dump(mode="json"), sender_id=user_id)
    return stop
