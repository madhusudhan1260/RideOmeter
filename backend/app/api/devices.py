import uuid

from fastapi import APIRouter, status
from sqlalchemy import select, update

from app.core.database import utcnow
from app.core.errors import NotFound
from app.core.permissions import DB, CurrentUser
from app.models import Device, HelmetDevice, Notification
from app.schemas.common import Message
from app.schemas.device import DeviceOut, DeviceRegister, HelmetIn, HelmetOut, NotificationOut

router = APIRouter(prefix="/api", tags=["devices"])


def _device_out(d: Device) -> DeviceOut:
    out = DeviceOut.model_validate(d)
    out.has_push_token = bool(d.push_token)
    return out


@router.post("/devices/register", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def register_device(data: DeviceRegister, db: DB, user: CurrentUser):
    d = db.scalar(select(Device).where(Device.user_id == user.id, Device.install_id == data.install_id))
    if d is None:
        d = Device(user_id=user.id, **data.model_dump())
        db.add(d)
    else:
        for k, v in data.model_dump().items():
            setattr(d, k, v)
        d.last_seen_at = utcnow()
    db.commit()
    return _device_out(d)


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(db: DB, user: CurrentUser):
    return [_device_out(d) for d in db.scalars(select(Device).where(Device.user_id == user.id))]


@router.delete("/devices/{device_id}", response_model=Message)
def delete_device(device_id: uuid.UUID, db: DB, user: CurrentUser):
    d = db.get(Device, device_id)
    if d is None or d.user_id != user.id:
        raise NotFound("Device not found")
    db.delete(d)
    db.commit()
    return Message(detail="Device removed")


@router.get("/devices/helmets", response_model=list[HelmetOut])
def list_helmets(db: DB, user: CurrentUser):
    return db.scalars(select(HelmetDevice).where(HelmetDevice.user_id == user.id)).all()


@router.post("/devices/helmets", response_model=HelmetOut)
def upsert_helmet(data: HelmetIn, db: DB, user: CurrentUser):
    h = db.scalar(
        select(HelmetDevice).where(HelmetDevice.user_id == user.id, HelmetDevice.address_hash == data.address_hash)
    )
    fields = data.model_dump(exclude={"make_preferred"})
    if h is None:
        h = HelmetDevice(user_id=user.id, **fields)
        db.add(h)
    else:
        for k, v in fields.items():
            if v is not None:
                setattr(h, k, v)
    h.last_connected_at = utcnow()
    db.flush()
    if data.make_preferred:
        user.profile.preferred_helmet_id = h.id
    db.commit()
    return h


@router.delete("/devices/helmets/{helmet_id}", response_model=Message)
def delete_helmet(helmet_id: uuid.UUID, db: DB, user: CurrentUser):
    h = db.get(HelmetDevice, helmet_id)
    if h is None or h.user_id != user.id:
        raise NotFound("Helmet not found")
    if user.profile.preferred_helmet_id == h.id:
        user.profile.preferred_helmet_id = None
    db.delete(h)
    db.commit()
    return Message(detail="Helmet removed")


@router.get("/notifications", response_model=list[NotificationOut], tags=["notifications"])
def list_notifications(db: DB, user: CurrentUser, unread_only: bool = False, limit: int = 50):
    q = select(Notification).where(Notification.recipient_id == user.id)
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    return db.scalars(q.order_by(Notification.created_at.desc()).limit(min(max(limit, 1), 200))).all()


@router.post("/notifications/read-all", response_model=Message, tags=["notifications"])
def read_all(db: DB, user: CurrentUser):
    db.execute(update(Notification).where(Notification.recipient_id == user.id, Notification.read_at.is_(None))
               .values(read_at=utcnow()))
    db.commit()
    return Message(detail="ok")
