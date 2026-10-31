"""Stops, emergencies, locations, announcements."""

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.core.permissions import DB, CurrentUser, require_admin, require_participant
from app.core.rate_limit import rate_limit
from app.models.enums import NotificationType
from app.schemas.common import Message
from app.schemas.events import EventType
from app.schemas.safety import (
    AnnouncementCreate,
    EmergencyCreate,
    EmergencyOut,
    LocationIn,
    RiderLocation,
    StopCreate,
    StopOut,
)
from app.services import emergency_service, location_service, stop_service
from app.services.audit import audit
from app.services.notification_service import notify_ride
from app.websocket.events import publish

router = APIRouter(prefix="/api", tags=["safety"])


# ---- stops ---------------------------------------------------------------

@router.post("/rides/{ride_id}/stops", response_model=StopOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("stop", 12, 60))])
def create_stop(ride_id: uuid.UUID, data: StopCreate, db: DB, user: CurrentUser, response: Response):
    ride, me = require_participant(db, ride_id, user)
    stop, created = stop_service.create(db, ride, me, data, transport="rest")
    if not created:
        response.status_code = status.HTTP_200_OK
    return stop_service.to_out(stop)


@router.get("/rides/{ride_id}/stops", response_model=list[StopOut])
def list_stops(ride_id: uuid.UUID, db: DB, user: CurrentUser, include_closed: bool = False):
    require_participant(db, ride_id, user)
    return stop_service.list_for_ride(db, ride_id, include_closed)


def _stop_action(action: str):
    def handler(stop_id: uuid.UUID, db: DB, user: CurrentUser) -> StopOut:
        return stop_service.to_out(stop_service.act(db, stop_id, user.id, action))

    handler.__name__ = f"stop_{action}"
    return handler


for _action in ("acknowledge", "approve", "reject", "complete"):
    router.add_api_route(f"/stops/{{stop_id}}/{_action}", _stop_action(_action), methods=["POST"],
                         response_model=StopOut, tags=["safety"])


# ---- emergencies -----------------------------------------------------------

@router.post("/rides/{ride_id}/emergency", response_model=EmergencyOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("sos", 10, 60))])
def create_emergency(ride_id: uuid.UUID, data: EmergencyCreate, db: DB, user: CurrentUser, response: Response):
    ride, me = require_participant(db, ride_id, user)
    e, created = emergency_service.create(db, ride, me, data, transport="rest")
    if not created:
        response.status_code = status.HTTP_200_OK
    return emergency_service.to_out(db, e)


@router.get("/rides/{ride_id}/emergency", response_model=list[EmergencyOut])
def list_emergencies(ride_id: uuid.UUID, db: DB, user: CurrentUser, active_only: bool = False):
    require_participant(db, ride_id, user)
    return emergency_service.list_for_ride(db, ride_id, active_only)


@router.post("/emergency/{emergency_id}/acknowledge", response_model=EmergencyOut)
def acknowledge_emergency(emergency_id: uuid.UUID, db: DB, user: CurrentUser):
    return emergency_service.to_out(db, emergency_service.acknowledge(db, emergency_id, user.id))


@router.post("/emergency/{emergency_id}/resolve", response_model=EmergencyOut)
def resolve_emergency(emergency_id: uuid.UUID, db: DB, user: CurrentUser):
    return emergency_service.to_out(db, emergency_service.resolve(db, emergency_id, user.id))


# ---- locations -------------------------------------------------------------

@router.post("/rides/{ride_id}/locations", response_model=Message, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("loc", 120, 60))])
def post_location(ride_id: uuid.UUID, data: LocationIn, db: DB, user: CurrentUser):
    ride, me = require_participant(db, ride_id, user)
    location_service.record(db, ride, me, data, source="rest")
    return Message(detail="ok")


@router.get("/rides/{ride_id}/locations", response_model=list[RiderLocation])
def get_locations(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, _ = require_participant(db, ride_id, user)
    return location_service.latest(db, ride)


# ---- announcements ---------------------------------------------------------

@router.post("/rides/{ride_id}/announcements", response_model=Message, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("announce", 20, 60))])
def announce(ride_id: uuid.UUID, data: AnnouncementCreate, db: DB, user: CurrentUser):
    ride, _ = require_admin(db, ride_id, user)
    notify_ride(db, ride.id, NotificationType.ANNOUNCEMENT, "Announcement", data.text, exclude=user.id)
    audit(db, "ride.announce", actor_id=user.id, ride_id=ride.id)
    db.commit()
    publish(ride.id, EventType.ADMIN_ANNOUNCEMENT,
            {"text": data.text, "speak": data.speak, "from": user.profile.display_name}, sender_id=user.id)
    return Message(detail="Announcement sent")
