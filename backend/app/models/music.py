import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, Enum, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TZDateTime, utcnow
from app.models.enums import MusicAction, MusicSource, MusicState
from app.models.mixins import Timestamps, UUIDPk


class MusicSession(UUIDPk, Timestamps, Base):
    """Authoritative group playback state for one ride.

    Position is stored as (position_ms at anchor_at). A client computes the live
    position as position_ms + (server_now - anchor_at) while PLAYING.
    """

    __tablename__ = "music_sessions"

    ride_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"), unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[MusicSource] = mapped_column(Enum(MusicSource, native_enum=False), default=MusicSource.LOCAL)
    state: Mapped[MusicState] = mapped_column(Enum(MusicState, native_enum=False), default=MusicState.STOPPED)
    queue: Mapped[list] = mapped_column(JSON, default=list)
    queue_index: Mapped[int] = mapped_column(Integer, default=0)
    position_ms: Mapped[int] = mapped_column(Integer, default=0)
    anchor_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    version: Mapped[int] = mapped_column(Integer, default=0)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))


class MusicEvent(UUIDPk, Base):
    __tablename__ = "music_events"

    session_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("music_sessions.id", ondelete="CASCADE"), index=True)
    action: Mapped[MusicAction] = mapped_column(Enum(MusicAction, native_enum=False))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    track_ref: Mapped[str | None] = mapped_column(String(200))
