import uuid
from datetime import datetime

from sqlalchemy import JSON, Enum, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TZDateTime, utcnow
from app.models.enums import NotificationType
from app.models.mixins import UUIDPk


class Notification(UUIDPk, Base):
    """One row per recipient. delivered_at is set only when the recipient's
    device acknowledges receipt — never on send."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_recipient_created", "recipient_id", "created_at"),
        Index("ix_notifications_ref", "ref_id"),
    )

    recipient_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    ride_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"))
    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType, native_enum=False))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(500))
    ref_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    read_at: Mapped[datetime | None] = mapped_column(TZDateTime)
