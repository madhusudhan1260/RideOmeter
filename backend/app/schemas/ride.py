import uuid

from pydantic import BaseModel, Field, model_validator

from app.models.enums import ParticipantRole, ParticipantStatus, RideStatus, RideVisibility, VoiceMode
from app.schemas.common import ORM, Lat, Lng, UTCDateTime


class Place(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    lat: Lat | None = None
    lng: Lng | None = None


class RideCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    start: Place
    destination: Place
    scheduled_at: UTCDateTime
    max_participants: int = Field(default=12, ge=2, le=50)
    visibility: RideVisibility = RideVisibility.PRIVATE
    requires_approval: bool = False
    voice_mode: VoiceMode = VoiceMode.PUSH_TO_TALK
    route_polyline: str | None = Field(default=None, max_length=200_000)


class RideUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    destination: Place | None = None
    scheduled_at: UTCDateTime | None = None
    max_participants: int | None = Field(default=None, ge=2, le=50)
    requires_approval: bool | None = None
    route_polyline: str | None = Field(default=None, max_length=200_000)


class JoinRequest(BaseModel):
    code: str = Field(min_length=4, max_length=64)


class ParticipantOut(BaseModel):
    user_id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None
    motorcycle: str | None
    role: ParticipantRole
    status: ParticipantStatus
    location_sharing: bool
    joined_at: UTCDateTime
    # Live presence comes from the WebSocket manager, never from the database.
    online: bool


class RideOut(ORM):
    id: uuid.UUID
    name: str
    description: str | None
    start_name: str
    start_lat: float | None
    start_lng: float | None
    dest_name: str
    dest_lat: float | None
    dest_lng: float | None
    route_polyline: str | None
    scheduled_at: UTCDateTime
    status: RideStatus
    visibility: RideVisibility
    max_participants: int
    requires_approval: bool
    voice_mode: VoiceMode
    music_enabled: bool
    created_by: uuid.UUID
    started_at: UTCDateTime | None
    ended_at: UTCDateTime | None
    created_at: UTCDateTime


class RideSummary(RideOut):
    my_role: ParticipantRole | None = None
    my_status: ParticipantStatus | None = None
    participant_count: int = 0
    # Only included for admins.
    join_code: str | None = None


class RideDetail(RideSummary):
    participants: list[ParticipantOut] = []
    invite_link: str | None = None


class InvitationCreate(BaseModel):
    expires_in_hours: int | None = Field(default=48, ge=1, le=24 * 30)
    max_uses: int | None = Field(default=None, ge=1, le=100)


class InvitationOut(ORM):
    id: uuid.UUID
    token: str
    link: str
    expires_at: UTCDateTime | None
    max_uses: int | None
    uses: int


class RoleUpdate(BaseModel):
    role: ParticipantRole

    @model_validator(mode="after")
    def _no_admin(self):
        if self.role == ParticipantRole.ADMIN:
            raise ValueError("Use transfer-admin to change the ride owner")
        return self


class VoiceModeUpdate(BaseModel):
    voice_mode: VoiceMode


class LocationSharingUpdate(BaseModel):
    enabled: bool


class OfflineCredentials(BaseModel):
    ride_id: uuid.UUID
    short_id: str
    offline_key: str
    participants: list[ParticipantOut]
    issued_at: UTCDateTime
