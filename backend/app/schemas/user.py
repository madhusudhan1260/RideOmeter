import uuid

from pydantic import BaseModel, Field

from app.schemas.common import ORM, UTCDateTime

PHONE = r"^\+?[0-9 \-]{6,20}$"


class MotorcycleIn(BaseModel):
    make: str = Field(min_length=1, max_length=48)
    model: str = Field(min_length=1, max_length=64)
    year: int | None = Field(default=None, ge=1900, le=2100)
    color: str | None = Field(default=None, max_length=32)
    plate: str | None = Field(default=None, max_length=20)


class MotorcycleOut(ORM):
    id: uuid.UUID
    make: str
    model: str
    year: int | None
    color: str | None
    plate: str | None
    is_primary: bool


class ProfileOut(ORM):
    display_name: str
    phone: str | None
    avatar_url: str | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    blood_group: str | None
    preferred_helmet_id: uuid.UUID | None
    notification_prefs: dict
    audio_prefs: dict


class MeOut(ORM):
    id: uuid.UUID
    email: str
    username: str
    created_at: UTCDateTime
    profile: ProfileOut
    motorcycles: list[MotorcycleOut]


class MeUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    phone: str | None = Field(default=None, pattern=PHONE)
    emergency_contact_name: str | None = Field(default=None, max_length=64)
    emergency_contact_phone: str | None = Field(default=None, pattern=PHONE)
    blood_group: str | None = Field(default=None, pattern=r"^(A|B|AB|O)[+-]$")
    preferred_helmet_id: uuid.UUID | None = None
    notification_prefs: dict[str, bool] | None = None
    audio_prefs: dict[str, float | bool | str] | None = None
    motorcycle: MotorcycleIn | None = None


class PublicUserOut(BaseModel):
    """What other riders in a shared ride may see. No e-mail, no phone."""

    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None
    motorcycle: str | None
