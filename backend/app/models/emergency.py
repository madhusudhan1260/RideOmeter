import uuid
from datetime import datetime

from sqlalchemy import Enum, Float, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TZDateTime, utcnow
from app.models.enums import EmergencyStatus, EmergencyType
from app.models.mixins import UUIDPk
from app.models.user import User


class EmergencyRequest(UUIDPk, Base):
    __tablename__ = "emergency_requests"
    __table_args__ = (Index("ix_emergency_ride_status", "ride_id", "status"),)

    ride_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"))
    reporter_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[EmergencyType] = mapped_column(Enum(EmergencyType, native_enum=False))
    status: Mapped[EmergencyStatus] = mapped_column(
        Enum(EmergencyStatus, native_enum=False), default=EmergencyStatus.ACTIVE
    )
    message: Mapped[str | None] = mapped_column(String(280))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    # Device time of the GPS fix — may be older than created_at (last known location).
    location_recorded_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    acknowledged_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    resolved_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    client_event_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)

    reporter: Mapped[User] = relationship(foreign_keys=[reporter_id])
