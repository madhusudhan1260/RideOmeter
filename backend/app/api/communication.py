import uuid

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from app.core.database import SessionLocal
from app.core.permissions import DB, CurrentUser, require_admin, require_participant
from app.integrations import livekit
from app.schemas.events import SyncBatch, SyncBatchResult
from app.schemas.ride import VoiceModeUpdate
from app.services import communication_service, sync_service
from app.services.communication_service import VoiceToken

router = APIRouter(prefix="/api", tags=["communication"])


@router.post("/rides/{ride_id}/voice/token", response_model=VoiceToken)
def voice_token(ride_id: uuid.UUID, db: DB, user: CurrentUser):
    ride, me = require_participant(db, ride_id, user)
    return communication_service.voice_token(ride, me)


@router.put("/rides/{ride_id}/voice/mode")
async def set_voice_mode(ride_id: uuid.UUID, data: VoiceModeUpdate, user: CurrentUser):
    def _apply():
        with SessionLocal() as db:
            ride, me = require_admin(db, ride_id, user)
            return communication_service.set_voice_mode(db, ride, me, data.voice_mode)

    perms = await run_in_threadpool(_apply)
    updated = await livekit.set_publish_permission(ride_id, perms)
    return {"voice_mode": data.voice_mode, "livekit_participants_updated": updated}


@router.post("/sync/events", response_model=SyncBatchResult, tags=["sync"])
def sync_events(batch: SyncBatch, db: DB, user: CurrentUser):
    return sync_service.apply_batch(db, user, batch)
