"""LiveKit access tokens and server-side permission updates.

Runs against a self-hosted `livekit-server --dev` (free) for local testing.
"""

import json
import logging
from datetime import timedelta

from livekit import api

from app.core.config import get_settings

log = logging.getLogger("ridewave.livekit")


def room_name(ride_id) -> str:
    return f"ride-{ride_id}"


def mint_token(*, ride_id, identity: str, name: str, can_publish: bool, metadata: dict) -> str:
    s = get_settings()
    grants = api.VideoGrants(
        room_join=True,
        room=room_name(ride_id),
        can_publish=can_publish,
        can_publish_sources=["microphone"] if can_publish else [],
        can_subscribe=True,
        can_publish_data=True,
    )
    return (
        api.AccessToken(s.livekit_api_key, s.livekit_api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_metadata(json.dumps(metadata))
        .with_grants(grants)
        .with_ttl(timedelta(hours=4))
        .to_jwt()
    )


async def set_publish_permission(ride_id, identities_can_publish: dict[str, bool]) -> int:
    """Best effort: apply a new voice mode to riders already in the room.
    Returns how many participants were updated; 0 if LiveKit is unreachable."""
    s = get_settings()
    http_url = s.livekit_url.replace("ws://", "http://").replace("wss://", "https://")
    updated = 0
    try:
        async with api.LiveKitAPI(http_url, s.livekit_api_key, s.livekit_api_secret) as lk:
            room = room_name(ride_id)
            res = await lk.room.list_participants(api.ListParticipantsRequest(room=room))
            for p in res.participants:
                allowed = identities_can_publish.get(p.identity)
                if allowed is None:
                    continue
                await lk.room.update_participant(
                    api.UpdateParticipantRequest(
                        room=room,
                        identity=p.identity,
                        permission=api.ParticipantPermission(
                            can_subscribe=True, can_publish=allowed, can_publish_data=True
                        ),
                    )
                )
                updated += 1
    except Exception as exc:  # noqa: BLE001 — LiveKit may not be running in dev
        log.warning("could not update LiveKit permissions for ride %s: %s", ride_id, exc)
    return updated
