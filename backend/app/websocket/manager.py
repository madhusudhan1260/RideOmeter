"""Per-ride WebSocket fan-out.

Single-process. For several API workers, put a Redis pub/sub channel per ride
behind `broadcast` — callers don't change.
"""

import asyncio
import logging
import uuid
from collections import defaultdict

from fastapi import WebSocket

from app.schemas.events import RideEvent

log = logging.getLogger("ridewave.ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, dict[uuid.UUID, set[WebSocket]]] = defaultdict(lambda: defaultdict(set))
        self._lock = asyncio.Lock()

    async def connect(self, ride_id: uuid.UUID, user_id: uuid.UUID, ws: WebSocket) -> bool:
        """Returns True if this is the user's first live socket for the ride."""
        async with self._lock:
            sockets = self._rooms[ride_id][user_id]
            first = not sockets
            sockets.add(ws)
            return first

    async def disconnect(self, ride_id: uuid.UUID, user_id: uuid.UUID, ws: WebSocket) -> bool:
        """Returns True if the user has no sockets left for the ride."""
        async with self._lock:
            room = self._rooms.get(ride_id)
            if not room or user_id not in room:
                return False
            room[user_id].discard(ws)
            if room[user_id]:
                return False
            del room[user_id]
            if not room:
                del self._rooms[ride_id]
            return True

    def online_users(self, ride_id: uuid.UUID) -> set[uuid.UUID]:
        room = self._rooms.get(ride_id)
        return set(room.keys()) if room else set()

    async def broadcast(self, event: RideEvent, exclude_user: uuid.UUID | None = None) -> int:
        room = self._rooms.get(event.ride_id)
        if not room:
            return 0
        data = event.model_dump(mode="json")
        targets = [(uid, ws) for uid, socks in list(room.items()) if uid != exclude_user for ws in list(socks)]
        results = await asyncio.gather(*(ws.send_json(data) for _, ws in targets), return_exceptions=True)
        sent = 0
        for (uid, ws), res in zip(targets, results, strict=True):
            if isinstance(res, Exception):
                log.info("drop dead socket ride=%s user=%s: %s", event.ride_id, uid, res)
                await self.disconnect(event.ride_id, uid, ws)
            else:
                sent += 1
        return sent

    async def send_to_user(self, ride_id: uuid.UUID, user_id: uuid.UUID, event: RideEvent) -> None:
        for ws in list(self._rooms.get(ride_id, {}).get(user_id, ())):
            try:
                await ws.send_json(event.model_dump(mode="json"))
            except Exception:  # noqa: BLE001
                await self.disconnect(ride_id, user_id, ws)

    async def kick(self, ride_id: uuid.UUID, user_id: uuid.UUID, reason: str) -> None:
        for ws in list(self._rooms.get(ride_id, {}).get(user_id, ())):
            try:
                await ws.close(code=4403, reason=reason)
            except Exception:  # noqa: BLE001
                pass
            await self.disconnect(ride_id, user_id, ws)


manager = ConnectionManager()
