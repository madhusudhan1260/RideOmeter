import uuid

from pydantic import BaseModel, Field

from app.models.enums import DevicePlatform
from app.schemas.common import ORM, UTCDateTime


class DeviceRegister(BaseModel):
    install_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9\-_]+$")
    platform: DevicePlatform
    model: str | None = Field(default=None, max_length=64)
    os_version: str | None = Field(default=None, max_length=32)
    app_version: str | None = Field(default=None, max_length=32)
    push_token: str | None = Field(default=None, max_length=512)
    supports_nearby: bool = False


class DeviceOut(ORM):
    id: uuid.UUID
    install_id: str
    platform: DevicePlatform
    model: str | None
    os_version: str | None
    app_version: str | None
    supports_nearby: bool
    last_seen_at: UTCDateTime
    has_push_token: bool = False


class HelmetIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    address_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    supports_hfp: bool | None = None
    supports_a2dp: bool | None = None
    supports_le_audio: bool | None = None
    last_mic_test_ok: bool | None = None
    last_speaker_test_ok: bool | None = None
    make_preferred: bool = False


class HelmetOut(ORM):
    id: uuid.UUID
    name: str
    supports_hfp: bool | None
    supports_a2dp: bool | None
    supports_le_audio: bool | None
    last_mic_test_ok: bool | None
    last_speaker_test_ok: bool | None
    last_connected_at: UTCDateTime | None


class NotificationOut(ORM):
    id: uuid.UUID
    ride_id: uuid.UUID | None
    type: str
    title: str
    body: str
    ref_id: uuid.UUID | None
    data: dict
    created_at: UTCDateTime
    delivered_at: UTCDateTime | None
    read_at: UTCDateTime | None
