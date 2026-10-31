import uuid
from datetime import datetime

from sqlalchemy import Boolean, Enum, Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TZDateTime, utcnow
from app.models.enums import RideStatus, RideVisibility, VoiceMode
from app.models.mixins import Timestamps, UUIDPk


class Ride(UUIDPk, Timestamps, Base):
    __tablename__ = "rides"
    __table_args__ = (Index("ix_rides_status_scheduled", "status", "scheduled_at"),)

    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    start_name: Mapped[str] = mapped_column(String(120))
    start_lat: Mapped[float | None] = mapped_column(Float)
    start_lng: Mapped[float | None] = mapped_column(Float)
    dest_name: Mapped[str] = mapped_column(String(120))
    dest_lat: Mapped[float | None] = mapped_column(Float)
    dest_lng: Mapped[float | None] = mapped_column(Float)
    # Encoded polyline (Google polyline algorithm, precision 5) from an OSM router.
    route_polyline: Mapped[str | None] = mapped_column(Text)
    scheduled_at: Mapped[datetime] = mapped_column(TZDateTime)
    status: Mapped[RideStatus] = mapped_column(Enum(RideStatus, native_enum=False), default=RideStatus.PLANNED)
    visibility: Mapped[RideVisibility] = mapped_column(
        Enum(RideVisibility, native_enum=False), default=RideVisibility.PRIVATE
    )
    max_participants: Mapped[int] = mapped_column(Integer, default=12)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    join_code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    # Shared secret for authenticating peers over Nearby when offline.
    offline_key: Mapped[str] = mapped_column(String(64))
    voice_mode: Mapped[VoiceMode] = mapped_column(Enum(VoiceMode, native_enum=False), default=VoiceMode.PUSH_TO_TALK)
    music_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    started_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    ended_at: Mapped[datetime | None] = mapped_column(TZDateTime)

    participants: Mapped[list["RideParticipant"]] = relationship(  # noqa: F821
        back_populates="ride", cascade="all, delete-orphan"
    )
    invitations: Mapped[list["RideInvitation"]] = relationship(back_populates="ride", cascade="all, delete-orphan")


class RideInvitation(UUIDPk, Base):
    __tablename__ = "ride_invitations"

    ride_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    max_uses: Mapped[int | None] = mapped_column(Integer)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)

    ride: Mapped[Ride] = relationship(back_populates="invitations")
