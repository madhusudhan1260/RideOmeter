import uuid

from fastapi import APIRouter

from app.core.permissions import DB, CurrentUser, require_admin, require_participant
from app.schemas.music import EnableRequest, MusicStatus, PauseRequest, PlayRequest, QueueUpdate
from app.services import music_service

router = APIRouter(prefix="/api/rides/{ride_id}/music", tags=["music"])


@router.get("/status", response_model=MusicStatus)
def music_status(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, _ = require_participant(db, ride_id, user)
    return music_service.status(music_service.get_session(db, ride))


@router.put("/queue", response_model=MusicStatus)
def set_queue(ride_id: uuid.UUID, data: QueueUpdate, db: DB, user: CurrentUser):
    ride, _ = require_admin(db, ride_id, user)
    return music_service.set_queue(db, ride, user, data)


@router.post("/play", response_model=MusicStatus)
def play(ride_id: uuid.UUID, db: DB, user: CurrentUser, data: PlayRequest | None = None):
    ride, _ = require_admin(db, ride_id, user)
    return music_service.play(db, ride, user, data or PlayRequest())


@router.post("/pause", response_model=MusicStatus)
def pause(ride_id: uuid.UUID, db: DB, user: CurrentUser, data: PauseRequest | None = None):
    ride, _ = require_admin(db, ride_id, user)
    return music_service.pause(db, ride, user, data or PauseRequest())


@router.post("/next", response_model=MusicStatus)
def next_track(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, _ = require_admin(db, ride_id, user)
    return music_service.skip(db, ride, user, forward=True)


@router.post("/previous", response_model=MusicStatus)
def previous_track(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, _ = require_admin(db, ride_id, user)
    return music_service.skip(db, ride, user, forward=False)


@router.put("/enabled", response_model=MusicStatus)
def set_enabled(ride_id: uuid.UUID, data: EnableRequest, db: DB, user: CurrentUser):
    ride, _ = require_admin(db, ride_id, user)
    return music_service.set_enabled(db, ride, user, data.enabled)
