from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict
from app.integrations import livekit
from app.models import Ride, RideParticipant
from app.models.enums import ParticipantStatus, RideStatus, VoiceMode
from app.schemas.events import EventType
from app.services.audit import audit
from app.websocket.events import publish


class VoiceToken(BaseModel):
    url: str
    token: str
    room: str
    voice_mode: VoiceMode
    can_publish: bool
    push_to_talk: bool


def can_publish(mode: VoiceMode, p: RideParticipant) -> bool:
    return mode != VoiceMode.ADMIN_ONLY or p.is_admin


def voice_token(ride: Ride, me: RideParticipant) -> VoiceToken:
    if ride.status in (RideStatus.ENDED, RideStatus.CANCELLED):
        raise Conflict("Ride has ended")
    allowed = can_publish(ride.voice_mode, me)
    token = livekit.mint_token(
        ride_id=ride.id,
        identity=str(me.user_id),
        name=me.user.profile.display_name,
        can_publish=allowed,
        metadata={"role": me.role.value},
    )
    return VoiceToken(
        url=get_settings().livekit_url,
        token=token,
        room=livekit.room_name(ride.id),
        voice_mode=ride.voice_mode,
        can_publish=allowed,
        push_to_talk=ride.voice_mode != VoiceMode.OPEN_MIC,
    )


def set_voice_mode(db: Session, ride: Ride, actor: RideParticipant, mode: VoiceMode) -> dict[str, bool]:
    ride.voice_mode = mode
    audit(db, "voice.mode", actor_id=actor.user_id, ride_id=ride.id, mode=mode.value)
    db.commit()
    parts = db.scalars(
        select(RideParticipant).where(
            RideParticipant.ride_id == ride.id, RideParticipant.status == ParticipantStatus.ACTIVE
        )
    ).all()
    publish(ride.id, EventType.VOICE_MODE_CHANGED, {"voice_mode": mode.value}, sender_id=actor.user_id)
    return {str(p.user_id): can_publish(mode, p) for p in parts}
