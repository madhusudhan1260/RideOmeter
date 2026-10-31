from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import as_utc, utcnow
from app.core.errors import BadRequest, Conflict, Forbidden
from app.models import LocationUpdate, Ride, RideParticipant
from app.models.enums import ParticipantStatus, RideStatus
from app.schemas.events import EventType
from app.schemas.safety import LocationIn, RiderLocation
from app.websocket.events import publish

_MAX_FUTURE = timedelta(minutes=2)


def record(db: Session, ride: Ride, me: RideParticipant, data: LocationIn, *, source: str = "rest",
           broadcast: bool = True) -> LocationUpdate:
    if ride.status in (RideStatus.ENDED, RideStatus.CANCELLED):
        raise Conflict("Ride has ended; location sharing stopped")
    if not me.location_sharing:
        raise Forbidden("Location sharing is turned off for this ride")
    recorded = as_utc(data.recorded_at)
    if recorded > utcnow() + _MAX_FUTURE:
        raise BadRequest("recorded_at is in the future — check the device clock")
    loc = LocationUpdate(ride_id=ride.id, user_id=me.user_id, source=source,
                         **data.model_dump(exclude={"recorded_at"}), recorded_at=recorded)
    db.add(loc)
    db.commit()
    if broadcast:
        publish(ride.id, EventType.LOCATION_UPDATED,
                {"user_id": str(me.user_id), **data.model_dump(mode="json")}, sender_id=me.user_id,
                exclude_user=me.user_id)
    return loc


def latest(db: Session, ride: Ride) -> list[RiderLocation]:
    live_s = get_settings().location_live_seconds
    now = utcnow()
    parts = db.scalars(
        select(RideParticipant).where(
            RideParticipant.ride_id == ride.id, RideParticipant.status == ParticipantStatus.ACTIVE
        )
    ).all()
    newest = (
        select(LocationUpdate.user_id, func.max(LocationUpdate.recorded_at).label("t"))
        .where(LocationUpdate.ride_id == ride.id)
        .group_by(LocationUpdate.user_id)
        .subquery()
    )
    rows = db.scalars(
        select(LocationUpdate).join(
            newest, (LocationUpdate.user_id == newest.c.user_id) & (LocationUpdate.recorded_at == newest.c.t)
        ).where(LocationUpdate.ride_id == ride.id)
    ).all()
    by_user = {r.user_id: r for r in rows}

    out = []
    for p in parts:
        base = dict(user_id=p.user_id, display_name=p.user.profile.display_name, role=p.role.value,
                    sharing=p.location_sharing)
        loc = by_user.get(p.user_id)
        if not p.location_sharing or loc is None:
            out.append(RiderLocation(freshness="UNAVAILABLE", **base))
            continue
        age = int((now - as_utc(loc.recorded_at)).total_seconds())
        out.append(
            RiderLocation(
                freshness="LIVE" if age <= live_s and ride.status == RideStatus.ACTIVE else "STALE",
                lat=loc.lat, lng=loc.lng, accuracy_m=loc.accuracy_m, speed_mps=loc.speed_mps,
                heading=loc.heading, battery_pct=loc.battery_pct, recorded_at=loc.recorded_at,
                age_seconds=max(age, 0), **base,
            )
        )
    return out


def set_sharing(db: Session, me: RideParticipant, enabled: bool) -> None:
    me.location_sharing = enabled
    db.commit()
    publish(me.ride_id, EventType.PRESENCE, {"user_id": str(me.user_id), "location_sharing": enabled},
            sender_id=me.user_id)


def purge_old(db: Session) -> int:
    cutoff = utcnow() - timedelta(days=get_settings().location_retention_days)
    res = db.execute(delete(LocationUpdate).where(LocationUpdate.received_at < cutoff))
    db.commit()
    return res.rowcount

