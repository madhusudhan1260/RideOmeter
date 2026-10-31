"""Stops, emergencies, locations."""

import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.models.enums import EmergencyStatus, EmergencyType, StopStatus, StopType
from app.schemas.common import Lat, Lng, UTCDateTime


class StopCreate(BaseModel):
    type: StopType
    note: str | None = Field(default=None, max_length=140)
    lat: Lat | None = None
    lng: Lng | None = None
    client_event_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _custom_needs_note(self):
        if self.type == StopType.CUSTOM and not (self.note and self.note.strip()):
            raise ValueError("Custom requests need a short note")
        return self


class StopOut(BaseModel):
    id: uuid.UUID
    ride_id: uuid.UUID
    requester_id: uuid.UUID
    requester_name: str
    type: StopType
    note: str | None
    status: StopStatus
    lat: float | None
    lng: float | None
    created_at: UTCDateTime
    expires_at: UTCDateTime
    handled_by: uuid.UUID | None
    handled_at: UTCDateTime | None
    announcement: str


class StopAction(BaseModel):
    action: Literal["acknowledge", "approve", "reject", "complete"]


class EmergencyCreate(BaseModel):
    type: EmergencyType
    message: str | None = Field(default=None, max_length=280)
    lat: Lat | None = None
    lng: Lng | None = None
    location_recorded_at: UTCDateTime | None = None
    client_event_id: uuid.UUID | None = None


class EmergencyContact(BaseModel):
    name: str | None
    phone: str | None
    blood_group: str | None


class EmergencyOut(BaseModel):
    id: uuid.UUID
    ride_id: uuid.UUID
    reporter_id: uuid.UUID
    reporter_name: str
    type: EmergencyType
    status: EmergencyStatus
    message: str | None
    lat: float | None
    lng: float | None
    location_recorded_at: UTCDateTime | None
    created_at: UTCDateTime
    acknowledged_by: uuid.UUID | None
    acknowledged_at: UTCDateTime | None
    resolved_at: UTCDateTime | None
    recipients: int
    delivered: int
    emergency_contact: EmergencyContact
    announcement: str


class LocationIn(BaseModel):
    lat: Lat
    lng: Lng
    accuracy_m: float | None = Field(default=None, ge=0, le=10_000)
    speed_mps: float | None = Field(default=None, ge=0, le=150)
    heading: float | None = Field(default=None, ge=0, lt=360)
    battery_pct: int | None = Field(default=None, ge=0, le=100)
    recorded_at: UTCDateTime


class RiderLocation(BaseModel):
    user_id: uuid.UUID
    display_name: str
    role: str
    freshness: Literal["LIVE", "STALE", "UNAVAILABLE"]
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    speed_mps: float | None = None
    heading: float | None = None
    battery_pct: int | None = None
    recorded_at: UTCDateTime | None = None
    age_seconds: int | None = None
    sharing: bool


class AnnouncementCreate(BaseModel):
    text: str = Field(min_length=1, max_length=280)
    speak: bool = True
