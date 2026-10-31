import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import Conflict, Forbidden, NotFound
from app.core.permissions import find_participant
from app.models import EmergencyRequest, Ride, RideParticipant
from app.models.enums import EmergencyStatus, EmergencyType, NotificationType, ParticipantStatus, RideStatus
from app.schemas.events import EventType
from app.schemas.safety import EmergencyContact, EmergencyCreate, EmergencyOut
from app.services.audit import audit
from app.services.notification_service import delivery_counts, notify_ride
from app.websocket.events import publish

_TEXT = {
    EmergencyType.SOS: "Emergency assistance requested by {name}.",
    EmergencyType.ACCIDENT: "Accident reported by {name}.",
    EmergencyType.BREAKDOWN: "Bike breakdown reported by {name}.",
    EmergencyType.ASSISTANCE: "{name} is asking for help from nearby riders.",
}


def to_out(db: Session, e: EmergencyRequest) -> EmergencyOut:
    prof = e.reporter.profile
    recipients, delivered = delivery_counts(db, e.id)
    return EmergencyOut(
        id=e.id,
        ride_id=e.ride_id,
        reporter_id=e.reporter_id,
        reporter_name=prof.display_name,
        type=e.type,
        status=e.status,
        message=e.message,
        lat=e.lat,
        lng=e.lng,
        location_recorded_at=e.location_recorded_at,
        created_at=e.created_at,
        acknowledged_by=e.acknowledged_by,
        acknowledged_at=e.acknowledged_at,
        resolved_at=e.resolved_at,
        recipients=recipients,
        delivered=delivered,
        emergency_contact=EmergencyContact(
            name=prof.emergency_contact_name, phone=prof.emergency_contact_phone, blood_group=prof.blood_group
        ),
        announcement=_TEXT[e.type].format(name=prof.display_name),
    )


def create(
    db: Session, ride: Ride, me: RideParticipant, data: EmergencyCreate, *, created_at=None, transport: str = "ws"
) -> tuple[EmergencyRequest, bool]:
    if data.client_event_id:
        existing = db.scalar(select(EmergencyRequest).where(EmergencyRequest.client_event_id == data.client_event_id))
        if existing is not None:
            if existing.ride_id != ride.id or existing.reporter_id != me.user_id:
                raise Conflict("Event id already used")
            return existing, False
    if ride.status in (RideStatus.ENDED, RideStatus.CANCELLED) and created_at is None:
        raise Conflict("Ride has ended — call local emergency services directly")

    e = EmergencyRequest(
        ride_id=ride.id,
        reporter_id=me.user_id,
        type=data.type,
        message=data.message,
        lat=data.lat,
        lng=data.lng,
        location_recorded_at=data.location_recorded_at,
        client_event_id=data.client_event_id,
        created_at=created_at or utcnow(),
    )
    db.add(e)
    db.flush()
    db.refresh(e)
    text = _TEXT[data.type].format(name=me.user.profile.display_name)
    notify_ride(db, ride.id, NotificationType.EMERGENCY, "EMERGENCY", text, ref_id=e.id, exclude=me.user_id,
                data={"type": data.type.value, "lat": data.lat, "lng": data.lng})
    audit(db, "emergency.create", actor_id=me.user_id, ride_id=ride.id, emergency_id=e.id, type=data.type.value,
          transport=transport)
    db.commit()
    publish(ride.id, EventType.EMERGENCY_CREATED, to_out(db, e).model_dump(mode="json"), sender_id=me.user_id,
            event_id=data.client_event_id)
    return e, True


def list_for_ride(db: Session, ride_id: uuid.UUID, active_only: bool) -> list[EmergencyOut]:
    q = select(EmergencyRequest).where(EmergencyRequest.ride_id == ride_id)
    if active_only:
        q = q.where(EmergencyRequest.status != EmergencyStatus.RESOLVED)
    return [to_out(db, e) for e in db.scalars(q.order_by(EmergencyRequest.created_at.desc()).limit(100))]


def _load(db: Session, emergency_id: uuid.UUID, user_id: uuid.UUID) -> tuple[EmergencyRequest, RideParticipant]:
    e = db.get(EmergencyRequest, emergency_id)
    p = find_participant(db, e.ride_id, user_id) if e else None
    if e is None or p is None or p.status != ParticipantStatus.ACTIVE:
        raise NotFound("Emergency not found")
    return e, p


def acknowledge(db: Session, emergency_id: uuid.UUID, user_id: uuid.UUID, *, at=None) -> EmergencyRequest:
    e, _ = _load(db, emergency_id, user_id)
    if e.reporter_id == user_id:
        raise Forbidden("Another rider must acknowledge your emergency")
    if e.status == EmergencyStatus.ACTIVE:
        e.status, e.acknowledged_by, e.acknowledged_at = EmergencyStatus.ACKNOWLEDGED, user_id, at or utcnow()
        audit(db, "emergency.ack", actor_id=user_id, ride_id=e.ride_id, emergency_id=e.id)
        db.commit()
        publish(e.ride_id, EventType.EMERGENCY_ACKNOWLEDGED, to_out(db, e).model_dump(mode="json"), sender_id=user_id)
    return e


def resolve(db: Session, emergency_id: uuid.UUID, user_id: uuid.UUID) -> EmergencyRequest:
    e, p = _load(db, emergency_id, user_id)
    if not (p.is_admin or e.reporter_id == user_id):
        raise Forbidden("Only the reporter or a ride admin can resolve this")
    if e.status != EmergencyStatus.RESOLVED:
        e.status, e.resolved_at = EmergencyStatus.RESOLVED, utcnow()
        audit(db, "emergency.resolve", actor_id=user_id, ride_id=e.ride_id, emergency_id=e.id)
        db.commit()
        publish(e.ride_id, EventType.EMERGENCY_RESOLVED, to_out(db, e).model_dump(mode="json"), sender_id=user_id)
    return e
