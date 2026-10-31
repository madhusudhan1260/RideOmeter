import uuid
from datetime import datetime

from sqlalchemy import Enum, Float, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TZDateTime, utcnow
from app.models.enums import StopStatus, StopType
from app.models.mixins import UUIDPk
from app.models.user import User


class StopRequest(UUIDPk, Base):
    __tablename__ = "stop_requests"
    __table_args__ = (Index("ix_stops_ride_status", "ride_id", "status"),)

    ride_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"))
    requester_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[StopType] = mapped_column(Enum(StopType, native_enum=False))
    note: Mapped[str | None] = mapped_column(String(140))
    status: Mapped[StopStatus] = mapped_column(Enum(StopStatus, native_enum=False), default=StopStatus.OPEN)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TZDateTime)
    handled_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    handled_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    client_event_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)

    requester: Mapped[User] = relationship(foreign_keys=[requester_id])
