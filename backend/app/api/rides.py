import io
import uuid
from typing import Literal

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, Query, Response, status

from app.core.permissions import DB, CurrentUser, require_admin, require_owner, require_participant
from app.core.rate_limit import rate_limit
from app.models.enums import ParticipantStatus
from app.schemas.common import Message
from app.schemas.ride import (
    InvitationCreate,
    InvitationOut,
    JoinRequest,
    LocationSharingUpdate,
    OfflineCredentials,
    RideCreate,
    RideDetail,
    RideSummary,
    RideUpdate,
    RoleUpdate,
)
from app.services import location_service, ride_service

router = APIRouter(prefix="/api/rides", tags=["rides"])


@router.post("", response_model=RideDetail, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("ride_create", 20, 3600))])
def create_ride(data: RideCreate, db: DB, user: CurrentUser):
    ride = ride_service.create_ride(db, user, data)
    _, me = require_participant(db, ride.id, user)
    return ride_service.detail(db, ride, me)


@router.get("", response_model=list[RideSummary])
def list_rides(db: DB, user: CurrentUser,
               scope: Literal["all", "upcoming", "recent", "active", "public"] = Query("all")):
    return ride_service.list_rides(db, user, scope)


@router.post("/join", response_model=RideDetail, dependencies=[Depends(rate_limit("join", 10, 60))])
def join_by_code(data: JoinRequest, db: DB, user: CurrentUser):
    p = ride_service.join(db, user, data.code)
    return _detail_for(db, user, p.ride_id)


def _detail_for(db, user, ride_id) -> RideDetail | RideSummary:
    ride, me = ride_service.get_visible(db, user, ride_id)
    if me is not None and me.status == ParticipantStatus.ACTIVE:
        return ride_service.detail(db, ride, me)
    return ride_service.summary(db, ride, me)


@router.get("/{ride_id}", response_model=RideDetail | RideSummary)
def get_ride(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    return _detail_for(db, user, ride_id)


@router.patch("/{ride_id}", response_model=RideDetail)
def update_ride(ride_id: uuid.UUID, data: RideUpdate, db: DB, user: CurrentUser):
    ride, me = require_admin(db, ride_id, user)
    ride_service.update_ride(db, ride, user, data)
    return ride_service.detail(db, ride, me)


@router.post("/{ride_id}/join", response_model=RideDetail | RideSummary,
             dependencies=[Depends(rate_limit("join", 10, 60))])
def join(ride_id: uuid.UUID, data: JoinRequest, db: DB, user: CurrentUser):
    ride_service.join(db, user, data.code, ride_id=ride_id)
    return _detail_for(db, user, ride_id)


@router.post("/{ride_id}/leave", response_model=Message)
def leave(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, me = require_participant(db, ride_id, user)
    ride_service.leave(db, ride, me)
    return Message(detail="You left the ride")


@router.post("/{ride_id}/start", response_model=RideDetail)
def start(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, me = require_admin(db, ride_id, user)
    ride_service.start(db, ride, user)
    return ride_service.detail(db, ride, me)


@router.post("/{ride_id}/end", response_model=RideDetail)
def end(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, me = require_admin(db, ride_id, user)
    ride_service.end(db, ride, user)
    return ride_service.detail(db, ride, me)


@router.delete("/{ride_id}/participants/{user_id}", response_model=Message)
def remove_participant(ride_id: uuid.UUID, user_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, me = require_admin(db, ride_id, user)
    ride_service.remove_participant(db, ride, me, user_id)
    return Message(detail="Rider removed")


@router.post("/{ride_id}/participants/{user_id}/approve", response_model=Message)
def approve(ride_id: uuid.UUID, user_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, _ = require_admin(db, ride_id, user)
    ride_service.approve(db, ride, user, user_id)
    return Message(detail="Rider approved")


@router.put("/{ride_id}/participants/{user_id}/role", response_model=Message)
def set_role(ride_id: uuid.UUID, user_id: uuid.UUID, data: RoleUpdate, db: DB, user: CurrentUser):
    ride, me = require_owner(db, ride_id, user)
    ride_service.set_role(db, ride, me, user_id, data.role)
    return Message(detail="Role updated")


@router.put("/{ride_id}/location-sharing", response_model=Message)
def location_sharing(ride_id: uuid.UUID, data: LocationSharingUpdate, db: DB, user: CurrentUser):
    _, me = require_participant(db, ride_id, user)
    location_service.set_sharing(db, me, data.enabled)
    return Message(detail="Location sharing " + ("on" if data.enabled else "off"))


@router.post("/{ride_id}/join-code", response_model=RideDetail)
def regenerate_code(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, me = require_admin(db, ride_id, user)
    ride_service.regenerate_code(db, ride, user)
    return ride_service.detail(db, ride, me)


@router.post("/{ride_id}/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
def create_invitation(ride_id: uuid.UUID, data: InvitationCreate, db: DB, user: CurrentUser):
    ride, _ = require_admin(db, ride_id, user)
    inv = ride_service.create_invitation(db, ride, user, data)
    return InvitationOut(id=inv.id, token=inv.token, link=ride_service.invite_link(inv.token),
                         expires_at=inv.expires_at, max_uses=inv.max_uses, uses=inv.uses)


@router.get("/{ride_id}/qr.svg", response_class=Response,
            responses={200: {"content": {"image/svg+xml": {}}}})
def invite_qr(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, _ = require_admin(db, ride_id, user)
    img = qrcode.make(ride_service.invite_link(ride.join_code), image_factory=qrcode.image.svg.SvgPathImage,
                      box_size=12, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@router.get("/{ride_id}/offline-credentials", response_model=OfflineCredentials)
def offline_credentials(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, me = require_participant(db, ride_id, user)
    return ride_service.offline_credentials(db, ride, me)

