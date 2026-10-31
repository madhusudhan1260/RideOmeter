import uuid
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.core.database import utcnow
from app.models.enums import SyncResult
from app.schemas.common import UTCDateTime


class EventType(str, Enum):
    RIDER_JOINED = "RIDER_JOINED"
    RIDER_LEFT = "RIDER_LEFT"
    RIDER_REMOVED = "RIDER_REMOVED"
    RIDER_ROLE_CHANGED = "RIDER_ROLE_CHANGED"
    RIDE_STARTED = "RIDE_STARTED"
    RIDE_ENDED = "RIDE_ENDED"
    RIDE_UPDATED = "RIDE_UPDATED"
    MUSIC_PLAY = "MUSIC_PLAY"
    MUSIC_PAUSE = "MUSIC_PAUSE"
    MUSIC_NEXT = "MUSIC_NEXT"
    MUSIC_PREV = "MUSIC_PREV"
    MUSIC_QUEUE = "MUSIC_QUEUE"
    MUSIC_ENABLED = "MUSIC_ENABLED"
    STOP_REQUESTED = "STOP_REQUESTED"
    STOP_ACKNOWLEDGED = "STOP_ACKNOWLEDGED"
    STOP_UPDATED = "STOP_UPDATED"
    EMERGENCY_CREATED = "EMERGENCY_CREATED"
    EMERGENCY_ACKNOWLEDGED = "EMERGENCY_ACKNOWLEDGED"
    EMERGENCY_RESOLVED = "EMERGENCY_RESOLVED"
    LOCATION_UPDATED = "LOCATION_UPDATED"
    RIDER_DISCONNECTED = "RIDER_DISCONNECTED"
    RIDER_RECONNECTED = "RIDER_RECONNECTED"
    ADMIN_ANNOUNCEMENT = "ADMIN_ANNOUNCEMENT"
    VOICE_MODE_CHANGED = "VOICE_MODE_CHANGED"
    PRESENCE = "PRESENCE"
    DELIVERY_ACK = "DELIVERY_ACK"
    CLOCK_PING = "CLOCK_PING"
    CLOCK_PONG = "CLOCK_PONG"
    ERROR = "ERROR"


class RideEvent(BaseModel):
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    event_type: EventType
    ride_id: uuid.UUID
    sender_id: uuid.UUID | None = None
    timestamp: UTCDateTime = Field(default_factory=utcnow)
    payload: dict[str, Any] = Field(default_factory=dict)
    delivery_status: str = "SENDING"
    transport: str = "ws"


class SyncEventIn(BaseModel):
    event_id: uuid.UUID
    event_type: EventType
    ride_id: uuid.UUID
    sender_id: uuid.UUID
    timestamp: UTCDateTime
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncBatch(BaseModel):
    events: list[SyncEventIn] = Field(min_length=1, max_length=500)


class SyncEventResult(BaseModel):
    event_id: uuid.UUID
    result: SyncResult
    reason: str | None = None


class SyncBatchResult(BaseModel):
    results: list[SyncEventResult]
    server_time: UTCDateTime
