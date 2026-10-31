import uuid
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import as_utc, utcnow
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.core.permissions import find_participant, get_ride
from app.core.security import new_join_code, new_offline_key, new_opaque_token
from app.models import CommunicationSession, Ride, RideInvitation, RideParticipant, StopRequest, User
from app.models.enums import (
    CommunicationKind,
    NotificationType,
    ParticipantRole,
    ParticipantStatus,
    RideStatus,
    RideVisibility,
    StopStatus,
)
from app.schemas.events import EventType
from app.schemas.ride import (
    InvitationCreate,
    OfflineCredentials,
    ParticipantOut,
    RideCreate,
    RideDetail,
    RideSummary,
    RideUpdate,
)
from app.services.audit import audit
from app.services.notification_service import notify_ride
from app.services.user_service import motorcycle_label
from app.websocket.events import kick, publish
from app.websocket.manager import manager

_SEATED = (ParticipantStatus.ACTIVE, ParticipantStatus.PENDING)


def invite_link(code: str) -> str:
    return f"{get_settings().public_base_url}/j/{code}"


def short_id(ride_id: uuid.UUID) -> str:
    return ride_id.hex[:8]


def participant_out(p: RideParticipant, online: set[uuid.UUID]) -> ParticipantOut:
    u = p.user
    return ParticipantOut(
        user_id=u.id,
        username=u.username,
        display_name=u.profile.display_name if u.profile else u.username,
        avatar_url=u.profile.avatar_url if u.profile else None,
        motorcycle=motorcycle_label(u),
        role=p.role,
        status=p.status,
        location_sharing=p.location_sharing,
        joined_at=p.joined_at,
        online=u.id in online,
    )


def _count_seated(db: Session, ride_id: uuid.UUID) -> int:
    return db.scalar(
        select(func.count()).where(RideParticipant.ride_id == ride_id, RideParticipant.status.in_(_SEATED))
    )


def summary(db: Session, ride: Ride, me: RideParticipant | None) -> RideSummary:
    out = RideSummary.model_validate(ride)
    out.join_code = None  # from_attributes would copy it; only admins may see it
    out.participant_count = db.scalar(
        select(func.count()).where(
            RideParticipant.ride_id == ride.id, RideParticipant.status == ParticipantStatus.ACTIVE
        )
    )
    if me is not None:
        out.my_role, out.my_status = me.role, me.status
        if me.is_admin and me.status == ParticipantStatus.ACTIVE:
            out.join_code = ride.join_code
    return out


def detail(db: Session, ride: Ride, me: RideParticipant) -> RideDetail:
    base = summary(db, ride, me)
    online = manager.online_users(ride.id)
    rows = db.scalars(
        select(RideParticipant)
        .where(RideParticipant.ride_id == ride.id, RideParticipant.status.in_(_SEATED))
        .order_by(RideParticipant.joined_at)
    ).all()
    visible = [r for r in rows if r.status == ParticipantStatus.ACTIVE or me.is_admin]
    return RideDetail(
        **base.model_dump(),
        participants=[participant_out(r, online) for r in visible],
        invite_link=invite_link(ride.join_code) if me.is_admin else None,
    )


def create_ride(db: Session, user: User, data: RideCreate) -> Ride:
    if as_utc(data.scheduled_at) < utcnow() - timedelta(hours=1):
        raise BadRequest("Ride date is in the past")
    for _ in range(5):
        ride = Ride(
            name=data.name.strip(),
            description=data.description,
            start_name=data.start.name,
            start_lat=data.start.lat,
            start_lng=data.start.lng,
            dest_name=data.destination.name,
            dest_lat=data.destination.lat,
            dest_lng=data.destination.lng,
            route_polyline=data.route_polyline,
            scheduled_at=data.scheduled_at,
            max_participants=data.max_participants,
            visibility=data.visibility,
            requires_approval=data.requires_approval,
            voice_mode=data.voice_mode,
            join_code=new_join_code(),
            offline_key=new_offline_key(),
            created_by=user.id,
        )
        ride.participants.append(RideParticipant(user_id=user.id, role=ParticipantRole.ADMIN))
        db.add(ride)
        try:
            db.flush()
            break
        except IntegrityError:  # join code collision, retry
            db.rollback()
    else:
        raise Conflict("Could not allocate a join code, try again")
    audit(db, "ride.create", actor_id=user.id, ride_id=ride.id)
    db.commit()
    return ride


def list_rides(db: Session, user: User, scope: str) -> list[RideSummary]:
    now = utcnow()
    if scope == "public":
        rides = db.scalars(
            select(Ride)
            .where(
                Ride.visibility == RideVisibility.PUBLIC,
                Ride.status == RideStatus.PLANNED,
                Ride.scheduled_at >= now - timedelta(hours=2),
            )
            .order_by(Ride.scheduled_at)
            .limit(50)
        ).all()
        mine = {
            p.ride_id: p
            for p in db.scalars(
                select(RideParticipant).where(
                    RideParticipant.user_id == user.id, RideParticipant.ride_id.in_([r.id for r in rides])
                )
            )
        }
        return [summary(db, r, mine.get(r.id)) for r in rides]

    q = (
        select(Ride, RideParticipant)
        .join(RideParticipant, RideParticipant.ride_id == Ride.id)
        .where(RideParticipant.user_id == user.id, RideParticipant.status.in_(_SEATED + (ParticipantStatus.LEFT,)))
    )
    if scope == "upcoming":
        q = q.where(Ride.status.in_([RideStatus.PLANNED, RideStatus.ACTIVE])).order_by(Ride.scheduled_at)
    elif scope == "recent":
        q = q.where(Ride.status.in_([RideStatus.ENDED, RideStatus.CANCELLED])).order_by(Ride.scheduled_at.desc())
    elif scope == "active":
        q = q.where(Ride.status == RideStatus.ACTIVE, RideParticipant.status == ParticipantStatus.ACTIVE)
    else:
        q = q.order_by(Ride.scheduled_at.desc())
    return [summary(db, r, p) for r, p in db.execute(q.limit(100)).all()]


def get_visible(db: Session, user: User, ride_id: uuid.UUID) -> tuple[Ride, RideParticipant | None]:
    ride = get_ride(db, ride_id)
    me = find_participant(db, ride_id, user.id)
    if me is None or me.status in (ParticipantStatus.REMOVED,):
        if ride.visibility != RideVisibility.PUBLIC:
            raise NotFound("Ride not found")
        me = None
    return ride, me


def _resolve_code(db: Session, code: str) -> tuple[Ride, RideInvitation | None]:
    code = code.strip()
    ride = db.scalar(select(Ride).where(Ride.join_code == code.upper()))
    if ride is not None:
        return ride, None
    inv = db.scalar(select(RideInvitation).where(RideInvitation.token == code))
    if inv is None or inv.revoked:
        raise NotFound("Invalid invitation code")
    if inv.expires_at and as_utc(inv.expires_at) <= utcnow():
        raise BadRequest("This invitation has expired")
    if inv.max_uses is not None and inv.uses >= inv.max_uses:
        raise BadRequest("This invitation has been used up")
    return inv.ride, inv


def join(db: Session, user: User, code: str, ride_id: uuid.UUID | None = None) -> RideParticipant:
    ride, inv = _resolve_code(db, code)
    if ride_id is not None and ride.id != ride_id:
        raise NotFound("Invalid invitation code")
    if ride.status in (RideStatus.ENDED, RideStatus.CANCELLED):
        raise Conflict("This ride has already ended")

    p = find_participant(db, ride.id, user.id)
    if p is not None:
        if p.status == ParticipantStatus.REMOVED:
            raise Forbidden("You were removed from this ride by the admin")
        if p.status in _SEATED:
            return p
    if _count_seated(db, ride.id) >= ride.max_participants:
        raise Conflict("This ride is full")

    status = ParticipantStatus.PENDING if ride.requires_approval else ParticipantStatus.ACTIVE
    if p is None:
        p = RideParticipant(ride_id=ride.id, user_id=user.id, status=status)
        db.add(p)
    else:
        p.status, p.left_at, p.joined_at, p.role = status, None, utcnow(), ParticipantRole.MEMBER
    if inv is not None:
        inv.uses += 1
    db.flush()
    name = user.profile.display_name
    if status == ParticipantStatus.ACTIVE:
        notify_ride(db, ride.id, NotificationType.RIDER_JOINED, "Rider joined", f"{name} joined {ride.name}",
                    exclude=user.id, ref_id=p.id)
    audit(db, "ride.join", actor_id=user.id, ride_id=ride.id, status=status.value)
    db.commit()
    db.refresh(p)
    if status == ParticipantStatus.ACTIVE:
        publish(ride.id, EventType.RIDER_JOINED, {"user_id": str(user.id), "display_name": name}, sender_id=user.id)
    return p


def approve(db: Session, ride: Ride, actor: User, user_id: uuid.UUID) -> RideParticipant:
    p = find_participant(db, ride.id, user_id)
    if p is None or p.status != ParticipantStatus.PENDING:
        raise NotFound("No pending request for this rider")
    p.status = ParticipantStatus.ACTIVE
    name = p.user.profile.display_name
    notify_ride(db, ride.id, NotificationType.RIDER_JOINED, "Rider joined", f"{name} joined {ride.name}",
                ref_id=p.id)
    audit(db, "ride.approve", actor_id=actor.id, ride_id=ride.id, user_id=user_id)
    db.commit()
    publish(ride.id, EventType.RIDER_JOINED, {"user_id": str(user_id), "display_name": name}, sender_id=actor.id)
    return p


def leave(db: Session, ride: Ride, me: RideParticipant) -> None:
    if me.role == ParticipantRole.ADMIN:
        successor = db.scalar(
            select(RideParticipant)
            .where(
                RideParticipant.ride_id == ride.id,
                RideParticipant.role == ParticipantRole.CO_ADMIN,
                RideParticipant.status == ParticipantStatus.ACTIVE,
            )
            .order_by(RideParticipant.joined_at)
        )
        others = _count_seated(db, ride.id) - 1
        if successor is None and others > 0:
            raise Conflict("Assign a co-admin or end the ride before leaving")
        if successor is not None:
            successor.role = ParticipantRole.ADMIN
        elif ride.status == RideStatus.PLANNED:
            ride.status = RideStatus.CANCELLED
    me.status, me.left_at = ParticipantStatus.LEFT, utcnow()
    if me.role == ParticipantRole.CO_ADMIN or me.role == ParticipantRole.ADMIN:
        me.role = ParticipantRole.MEMBER
    name = me.user.profile.display_name
    notify_ride(db, ride.id, NotificationType.RIDER_LEFT, "Rider left", f"{name} left the ride", exclude=me.user_id)
    audit(db, "ride.leave", actor_id=me.user_id, ride_id=ride.id)
    db.commit()
    publish(ride.id, EventType.RIDER_LEFT, {"user_id": str(me.user_id), "display_name": name}, sender_id=me.user_id)
    kick(ride.id, me.user_id, "left ride")


def remove_participant(db: Session, ride: Ride, actor: RideParticipant, user_id: uuid.UUID) -> None:
    if user_id == actor.user_id:
        raise BadRequest("Use leave to exit the ride yourself")
    p = find_participant(db, ride.id, user_id)
    if p is None or p.status not in _SEATED:
        raise NotFound("Rider is not in this ride")
    if p.role == ParticipantRole.ADMIN:
        raise Forbidden("The ride admin cannot be removed")
    if p.role == ParticipantRole.CO_ADMIN and actor.role != ParticipantRole.ADMIN:
        raise Forbidden("Only the admin can remove a co-admin")
    p.status, p.left_at, p.role = ParticipantStatus.REMOVED, utcnow(), ParticipantRole.MEMBER
    audit(db, "ride.remove", actor_id=actor.user_id, ride_id=ride.id, user_id=user_id)
    db.commit()
    publish(ride.id, EventType.RIDER_REMOVED, {"user_id": str(user_id)}, sender_id=actor.user_id)
    kick(ride.id, user_id, "removed by admin")


def set_role(db: Session, ride: Ride, actor: RideParticipant, user_id: uuid.UUID, role: ParticipantRole) -> None:
    p = find_participant(db, ride.id, user_id)
    if p is None or p.status != ParticipantStatus.ACTIVE:
        raise NotFound("Rider is not in this ride")
    if p.role == ParticipantRole.ADMIN:
        raise Forbidden("The admin's role cannot be changed")
    p.role = role
    audit(db, "ride.role", actor_id=actor.user_id, ride_id=ride.id, user_id=user_id, role=role.value)
    db.commit()
    publish(ride.id, EventType.RIDER_ROLE_CHANGED, {"user_id": str(user_id), "role": role.value},
            sender_id=actor.user_id)


def update_ride(db: Session, ride: Ride, actor: User, data: RideUpdate) -> Ride:
    if ride.status in (RideStatus.ENDED, RideStatus.CANCELLED):
        raise Conflict("Ride has ended")
    fields = data.model_dump(exclude_unset=True, exclude={"destination"})
    if "max_participants" in fields and fields["max_participants"] < _count_seated(db, ride.id):
        raise BadRequest("More riders have already joined than that limit")
    for k, v in fields.items():
        setattr(ride, k, v)
    route_changed = data.destination is not None or "route_polyline" in fields
    if data.destination is not None:
        ride.dest_name, ride.dest_lat, ride.dest_lng = data.destination.name, data.destination.lat, data.destination.lng
    if route_changed:
        notify_ride(db, ride.id, NotificationType.ROUTE_CHANGED, "Route changed",
                    f"New destination: {ride.dest_name}", exclude=actor.id)
    audit(db, "ride.update", actor_id=actor.id, ride_id=ride.id, fields=sorted(data.model_fields_set))
    db.commit()
    publish(ride.id, EventType.RIDE_UPDATED, {"route_changed": route_changed}, sender_id=actor.id)
    return ride


def start(db: Session, ride: Ride, actor: User) -> Ride:
    if ride.status != RideStatus.PLANNED:
        raise Conflict(f"Ride is {ride.status.value.lower()}, cannot start")
    ride.status, ride.started_at = RideStatus.ACTIVE, utcnow()
    db.add(CommunicationSession(ride_id=ride.id, kind=CommunicationKind.LIVEKIT, room_name=f"ride-{ride.id}",
                                voice_mode=ride.voice_mode))
    notify_ride(db, ride.id, NotificationType.RIDE_STARTED, "Ride started", f"{ride.name} is rolling",
                exclude=actor.id)
    audit(db, "ride.start", actor_id=actor.id, ride_id=ride.id)
    db.commit()
    publish(ride.id, EventType.RIDE_STARTED, {"started_at": ride.started_at.isoformat()}, sender_id=actor.id)
    return ride


def end(db: Session, ride: Ride, actor: User) -> Ride:
    if ride.status not in (RideStatus.PLANNED, RideStatus.ACTIVE):
        raise Conflict("Ride has already ended")
    now = utcnow()
    ride.status = RideStatus.ENDED if ride.status == RideStatus.ACTIVE else RideStatus.CANCELLED
    ride.ended_at = now
    db.execute(
        update(CommunicationSession)
        .where(CommunicationSession.ride_id == ride.id, CommunicationSession.ended_at.is_(None))
        .values(ended_at=now)
    )
    db.execute(
        update(StopRequest)
        .where(StopRequest.ride_id == ride.id, StopRequest.status.in_([StopStatus.OPEN, StopStatus.ACKNOWLEDGED,
                                                                         StopStatus.APPROVED]))
        .values(status=StopStatus.EXPIRED)
    )
    notify_ride(db, ride.id, NotificationType.RIDE_ENDED, "Ride ended", f"{ride.name} has ended", exclude=actor.id)
    audit(db, "ride.end", actor_id=actor.id, ride_id=ride.id, status=ride.status.value)
    db.commit()
    publish(ride.id, EventType.RIDE_ENDED, {"status": ride.status.value}, sender_id=actor.id)
    return ride


def regenerate_code(db: Session, ride: Ride, actor: User) -> Ride:
    for _ in range(5):
        ride.join_code = new_join_code()
        try:
            db.flush()
            break
        except IntegrityError:
            db.rollback()
    audit(db, "ride.code_regenerated", actor_id=actor.id, ride_id=ride.id)
    db.commit()
    return ride


def create_invitation(db: Session, ride: Ride, actor: User, data: InvitationCreate) -> RideInvitation:
    inv = RideInvitation(
        ride_id=ride.id,
        token=new_opaque_token()[:32],
        created_by=actor.id,
        expires_at=utcnow() + timedelta(hours=data.expires_in_hours) if data.expires_in_hours else None,
        max_uses=data.max_uses,
    )
    db.add(inv)
    audit(db, "ride.invite", actor_id=actor.id, ride_id=ride.id)
    db.commit()
    return inv


def offline_credentials(db: Session, ride: Ride, me: RideParticipant) -> OfflineCredentials:
    if ride.status in (RideStatus.ENDED, RideStatus.CANCELLED):
        raise Conflict("Ride has ended")
    online = manager.online_users(ride.id)
    rows = db.scalars(
        select(RideParticipant).where(
            RideParticipant.ride_id == ride.id, RideParticipant.status == ParticipantStatus.ACTIVE
        )
    ).all()
    audit(db, "ride.offline_credentials", actor_id=me.user_id, ride_id=ride.id)
    db.commit()
    return OfflineCredentials(
        ride_id=ride.id,
        short_id=short_id(ride.id),
        offline_key=ride.offline_key,
        participants=[participant_out(r, online) for r in rows],
        issued_at=utcnow(),
    )
