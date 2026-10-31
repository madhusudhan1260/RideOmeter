"""Notification rows + push delivery.

Push (FCM) needs a Firebase project. Until `PushSender` is configured the
in-app WebSocket channel and the phone's local notifications are the delivery
paths; nothing here pretends a push was sent.
"""

import logging
import uuid
from typing import Protocol

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models import Device, Notification, RideParticipant
from app.models.enums import NotificationType, ParticipantStatus

log = logging.getLogger("ridewave.notify")


class PushSender(Protocol):
    def send(self, tokens: list[str], title: str, body: str, data: dict) -> int: ...


class DisabledPushSender:
    def send(self, tokens: list[str], title: str, body: str, data: dict) -> int:
        if tokens:
            log.info("push disabled: %d device(s) would be notified: %s", len(tokens), title)
        return 0


push_sender: PushSender = DisabledPushSender()


def active_participant_ids(db: Session, ride_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(RideParticipant.user_id).where(
                RideParticipant.ride_id == ride_id, RideParticipant.status == ParticipantStatus.ACTIVE
            )
        )
    )


def notify_ride(
    db: Session,
    ride_id: uuid.UUID,
    type_: NotificationType,
    title: str,
    body: str,
    *,
    ref_id: uuid.UUID | None = None,
    exclude: uuid.UUID | None = None,
    data: dict | None = None,
) -> int:
    """Stage one notification per active participant. Returns recipient count."""
    recipients = [uid for uid in active_participant_ids(db, ride_id) if uid != exclude]
    for uid in recipients:
        db.add(
            Notification(
                recipient_id=uid, ride_id=ride_id, type=type_, title=title, body=body, ref_id=ref_id, data=data or {}
            )
        )
    if recipients:
        tokens = list(
            db.scalars(select(Device.push_token).where(Device.user_id.in_(recipients), Device.push_token.is_not(None)))
        )
        push_sender.send(tokens, title, body, {"ride_id": str(ride_id), "ref_id": str(ref_id or "")})
    return len(recipients)


def mark_delivered(db: Session, user_id: uuid.UUID, ref_id: uuid.UUID) -> bool:
    res = db.execute(
        update(Notification)
        .where(Notification.recipient_id == user_id, Notification.ref_id == ref_id, Notification.delivered_at.is_(None))
        .values(delivered_at=utcnow())
    )
    db.commit()
    return res.rowcount > 0


def delivery_counts(db: Session, ref_id: uuid.UUID) -> tuple[int, int]:
    rows = db.execute(select(Notification.delivered_at).where(Notification.ref_id == ref_id)).all()
    return len(rows), sum(1 for (d,) in rows if d is not None)
