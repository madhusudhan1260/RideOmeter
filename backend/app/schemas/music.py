import re
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.enums import MusicSource, MusicState
from app.schemas.common import UTCDateTime

_SPOTIFY_URI = re.compile(r"^spotify:(track|episode):[A-Za-z0-9]{22}$")
_LOCAL_ID = re.compile(r"^[a-f0-9]{64}$")


class Track(BaseModel):
    source: MusicSource
    # LOCAL: sha256 content fingerprint; SPOTIFY: spotify:track:<id>
    ref: str = Field(max_length=200)
    title: str = Field(min_length=1, max_length=200)
    artist: str | None = Field(default=None, max_length=200)
    album: str | None = Field(default=None, max_length=200)
    artwork_url: str | None = Field(default=None, max_length=500)
    duration_ms: int = Field(ge=0, le=6 * 60 * 60 * 1000)

    @model_validator(mode="after")
    def _ref_shape(self):
        if self.source == MusicSource.SPOTIFY and not _SPOTIFY_URI.match(self.ref):
            raise ValueError("Spotify ref must be a spotify:track URI")
        if self.source == MusicSource.LOCAL and not _LOCAL_ID.match(self.ref):
            raise ValueError("Local ref must be a 64-char sha256 fingerprint")
        return self

    @field_validator("artwork_url")
    @classmethod
    def _https(cls, v: str | None) -> str | None:
        if v and not v.startswith("https://"):
            raise ValueError("artwork_url must be https")
        return v


class QueueUpdate(BaseModel):
    source: MusicSource
    tracks: list[Track] = Field(min_length=1, max_length=200)
    start_index: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _consistent(self):
        if any(t.source != self.source for t in self.tracks):
            raise ValueError("All tracks in a queue must share the same source")
        if self.start_index >= len(self.tracks):
            raise ValueError("start_index out of range")
        return self


class PlayRequest(BaseModel):
    queue_index: int | None = Field(default=None, ge=0)
    position_ms: int | None = Field(default=None, ge=0)
    # Lead time so every phone can buffer before the synchronized start.
    lead_ms: int = Field(default=1500, ge=0, le=10_000)


class PauseRequest(BaseModel):
    position_ms: int | None = Field(default=None, ge=0)


class EnableRequest(BaseModel):
    enabled: bool


class MusicStatus(BaseModel):
    ride_id: uuid.UUID
    enabled: bool
    source: MusicSource
    state: MusicState
    queue: list[Track]
    queue_index: int
    current: Track | None
    position_ms: int
    anchor_at: UTCDateTime
    server_time: UTCDateTime
    version: int
