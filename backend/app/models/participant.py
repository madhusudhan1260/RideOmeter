import uuid
from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey, Index, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TZDateTime, utcnow
from app.models.enums import ParticipantRole, ParticipantStatus
from app.models.mixins import UUIDPk
from app.models.ride import Ride
from app.models.user import User


class RideParticipant(UUIDPk, Base):
    __tablename__ = "ride_participants"
    __table_args__ = (
        UniqueConstraint("ride_id", "user_id", name="uq_participant_ride_user"),
        Index("ix_participants_user_status", "user_id", "status"),
    )

    ride_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rides.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[ParticipantRole] = mapped_column(
        Enum(ParticipantRole, native_enum=False), default=ParticipantRole.MEMBER
    )
    status: Mapped[ParticipantStatus] = mapped_column(
        Enum(ParticipantStatus, native_enum=False), default=ParticipantStatus.ACTIVE
    )
    location_sharing: Mapped[bool] = mapped_column(Boolean, default=True)
    joined_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    left_at: Mapped[datetime | None] = mapped_column(TZDateTime)

    ride: Mapped[Ride] = relationship(back_populates="participants")
    user: Mapped[User] = relationship()

    @property
    def is_admin(self) -> bool:
        return self.role in (ParticipantRole.ADMIN, ParticipantRole.CO_ADMIN)
