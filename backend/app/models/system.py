"""Communication sessions, audit logs and offline sync bookkeeping."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, Enum, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TZDateTime, utcnow
from app.models.enums import CommunicationKind, SyncResult, VoiceMode
from app.models.mixins import UUIDPk


class CommunicationSession(UUIDPk, Base):
    __tablename__ = "communication_sessions"
    __table_args__ = (Index("ix_comm_ride_kind", "ride_id", "kind"),)

    ride_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"))
    kind: Mapped[CommunicationKind] = mapped_column(Enum(CommunicationKind, native_enum=False))
    room_name: Mapped[str] = mapped_column(String(80))
    voice_mode: Mapped[VoiceMode] = mapped_column(Enum(VoiceMode, native_enum=False))
    started_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(TZDateTime)


class AuditLog(UUIDPk, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_ride_created", "ride_id", "created_at"),)

    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    ride_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    ip: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)


class OfflineSyncEvent(UUIDPk, Base):
    __tablename__ = "offline_sync_events"

    event_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, index=True)
    ride_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    uploader_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    event_type: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    client_timestamp: Mapped[datetime] = mapped_column(TZDateTime)
    received_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    result: Mapped[SyncResult] = mapped_column(Enum(SyncResult, native_enum=False))
    reason: Mapped[str | None] = mapped_column(String(200))
