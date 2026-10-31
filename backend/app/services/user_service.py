import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.core.config import get_settings
from app.core.errors import BadRequest, NotFound
from app.models import HelmetDevice, Motorcycle, RideParticipant, User
from app.models.enums import ParticipantStatus
from app.schemas.user import MeUpdate, PublicUserOut

_IMAGE_SIGNATURES = {b"\x89PNG\r\n\x1a\n": "png", b"\xff\xd8\xff": "jpg"}


def primary_motorcycle(user: User) -> Motorcycle | None:
    for m in user.motorcycles:
        if m.is_primary:
            return m
    return user.motorcycles[0] if user.motorcycles else None


def motorcycle_label(user: User) -> str | None:
    m = primary_motorcycle(user)
    return f"{m.make} {m.model}".strip() if m else None


def public_user(user: User) -> PublicUserOut:
    return PublicUserOut(
        id=user.id,
        username=user.username,
        display_name=user.profile.display_name if user.profile else user.username,
        avatar_url=user.profile.avatar_url if user.profile else None,
        motorcycle=motorcycle_label(user),
    )


def update_me(db: Session, user: User, data: MeUpdate) -> User:
    fields = data.model_dump(exclude_unset=True, exclude={"motorcycle"})
    if "preferred_helmet_id" in fields and fields["preferred_helmet_id"] is not None:
        helmet = db.get(HelmetDevice, fields["preferred_helmet_id"])
        if helmet is None or helmet.user_id != user.id:
            raise BadRequest("Unknown helmet device")
    for key, value in fields.items():
        setattr(user.profile, key, value)
    if data.motorcycle is not None:
        bike = primary_motorcycle(user)
        if bike is None:
            bike = Motorcycle(user_id=user.id, is_primary=True, **data.motorcycle.model_dump())
            user.motorcycles.append(bike)
        else:
            for k, v in data.motorcycle.model_dump().items():
                setattr(bike, k, v)
    db.commit()
    db.refresh(user)
    return user


def save_avatar(db: Session, user: User, content: bytes) -> str:
    s = get_settings()
    if len(content) > s.max_avatar_bytes:
        raise BadRequest("Image too large (max 2 MB)")
    ext = next((e for sig, e in _IMAGE_SIGNATURES.items() if content.startswith(sig)), None)
    if ext is None:
        raise BadRequest("Only PNG or JPEG images are accepted")
    folder = Path(s.media_dir) / "avatars"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{user.id}-{uuid.uuid4().hex[:8]}.{ext}"
    (folder / name).write_bytes(content)
    url = f"{s.public_base_url}/media/avatars/{name}"
    user.profile.avatar_url = url
    db.commit()
    return url


def visible_user(db: Session, viewer: User, user_id: uuid.UUID) -> User:
    """Another user's public profile is visible only if both share a ride."""
    if user_id == viewer.id:
        return viewer
    mine = aliased(RideParticipant)
    theirs = aliased(RideParticipant)
    shared = db.scalar(
        select(theirs.id)
        .join(mine, mine.ride_id == theirs.ride_id)
        .where(
            mine.user_id == viewer.id,
            theirs.user_id == user_id,
            mine.status.in_([ParticipantStatus.ACTIVE, ParticipantStatus.LEFT]),
            theirs.status != ParticipantStatus.REMOVED,
        )
        .limit(1)
    )
    user = db.get(User, user_id) if shared else None
    if user is None:
        raise NotFound("User not found")
    return user
