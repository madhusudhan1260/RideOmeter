"""Authentication dependency and ride-scoped authorization helpers.

Rule of thumb: a user who is not an active participant of a private ride gets
404, not 403, so ride ids cannot be probed.
"""

import uuid
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import Forbidden, NotFound, Unauthorized
from app.core.security import decode_access_token
from app.models import Ride, RideParticipant, User
from app.models.enums import ParticipantRole, ParticipantStatus

_bearer = HTTPBearer(auto_error=False)

DB = Annotated[Session, Depends(get_db)]


def user_from_token(db: Session, token: str | None) -> User:
    user_id = decode_access_token(token) if token else None
    if user_id is None:
        raise Unauthorized("Invalid or expired access token")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise Unauthorized("Account not found or disabled")
    return user


def get_current_user(
    db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> User:
    return user_from_token(db, creds.credentials if creds else None)


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_ride(db: Session, ride_id: uuid.UUID) -> Ride:
    ride = db.get(Ride, ride_id)
    if ride is None:
        raise NotFound("Ride not found")
    return ride


def find_participant(db: Session, ride_id: uuid.UUID, user_id: uuid.UUID) -> RideParticipant | None:
    return db.scalar(
        select(RideParticipant).where(RideParticipant.ride_id == ride_id, RideParticipant.user_id == user_id)
    )


def require_participant(db: Session, ride_id: uuid.UUID, user: User) -> tuple[Ride, RideParticipant]:
    ride = get_ride(db, ride_id)
    p = find_participant(db, ride_id, user.id)
    if p is None or p.status != ParticipantStatus.ACTIVE:
        raise NotFound("Ride not found")
    return ride, p


def require_admin(db: Session, ride_id: uuid.UUID, user: User) -> tuple[Ride, RideParticipant]:
    ride, p = require_participant(db, ride_id, user)
    if not p.is_admin:
        raise Forbidden("Only the ride admin or co-admin can do this")
    return ride, p


def require_owner(db: Session, ride_id: uuid.UUID, user: User) -> tuple[Ride, RideParticipant]:
    ride, p = require_participant(db, ride_id, user)
    if p.role != ParticipantRole.ADMIN:
        raise Forbidden("Only the ride admin can do this")
    return ride, p
