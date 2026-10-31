import uuid
from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TZDateTime, utcnow
from app.models.enums import DevicePlatform
from app.models.mixins import Timestamps, UUIDPk


class Device(UUIDPk, Timestamps, Base):
    """A phone installation belonging to a user (push token, app version)."""

    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("user_id", "install_id", name="uq_device_user_install"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    install_id: Mapped[str] = mapped_column(String(64))
    platform: Mapped[DevicePlatform] = mapped_column(Enum(DevicePlatform, native_enum=False))
    model: Mapped[str | None] = mapped_column(String(64))
    os_version: Mapped[str | None] = mapped_column(String(32))
    app_version: Mapped[str | None] = mapped_column(String(32))
    push_token: Mapped[str | None] = mapped_column(String(512))
    supports_nearby: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)


class HelmetDevice(UUIDPk, Timestamps, Base):
    """A Bluetooth headset the rider has used. Pairing is done by the OS; we only remember it."""

    __tablename__ = "helmet_devices"
    __table_args__ = (UniqueConstraint("user_id", "address_hash", name="uq_helmet_user_address"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    # SHA-256 of the BT MAC so we can recognise it without storing the raw address.
    address_hash: Mapped[str] = mapped_column(String(64))
    supports_hfp: Mapped[bool | None] = mapped_column(Boolean)
    supports_a2dp: Mapped[bool | None] = mapped_column(Boolean)
    supports_le_audio: Mapped[bool | None] = mapped_column(Boolean)
    last_mic_test_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_speaker_test_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_connected_at: Mapped[datetime | None] = mapped_column(TZDateTime)
