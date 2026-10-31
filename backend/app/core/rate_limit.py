"""In-process sliding-window rate limiter.

Good enough for a single API instance. With several instances behind a load
balancer, swap the store for Redis (INCR + EXPIRE) — the dependency API stays
the same.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()


def rate_limit(scope: str, limit: int, window_s: float):
    def dependency(request: Request) -> None:
        client = request.client.host if request.client else "unknown"
        auth = request.headers.get("authorization", "")[-16:]
        if not limiter.hit(f"{scope}:{client}:{auth}", limit, window_s):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests, slow down")

    return dependency
