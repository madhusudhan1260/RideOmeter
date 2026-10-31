import uuid
from datetime import datetime

from sqlalchemy import Float, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TZDateTime, utcnow
from app.models.mixins import UUIDPk


class LocationUpdate(UUIDPk, Base):
    __tablename__ = "location_updates"
    __table_args__ = (Index("ix_locations_ride_user_time", "ride_id", "user_id", "recorded_at"),)

    ride_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float)
    speed_mps: Mapped[float | None] = mapped_column(Float)
    heading: Mapped[float | None] = mapped_column(Float)
    battery_pct: Mapped[int | None] = mapped_column(Integer)
    recorded_at: Mapped[datetime] = mapped_column(TZDateTime)
    received_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    source: Mapped[str] = mapped_column(String(8), default="rest")
