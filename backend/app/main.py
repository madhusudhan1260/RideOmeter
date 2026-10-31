import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api import auth, communication, devices, music, rides, safety, users
from app.core.config import get_settings
from app.core.database import SessionLocal, utcnow
from app.core.errors import AppError
from app.websocket import routes as ws_routes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ridewave")


@asynccontextmanager
async def lifespan(_: FastAPI):
    s = get_settings()
    Path(s.media_dir, "avatars").mkdir(parents=True, exist_ok=True)
    log.info("RideOmeter API starting (env=%s, db=%s)", s.env, s.database_url.split("@")[-1])
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title=s.app_name, version="0.1.0", lifespan=lifespan,
                  docs_url="/docs" if s.env != "production" else None)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        response.headers["x-content-type-options"] = "nosniff"
        log.info("%s %s %s %.0fms rid=%s", request.method, request.url.path, response.status_code,
                 (time.perf_counter() - start) * 1000, rid)
        return response

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse({"detail": exc.detail, **exc.extra}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        errors = [{"loc": e["loc"], "msg": e["msg"]} for e in exc.errors()]
        return JSONResponse({"detail": "Validation failed", "errors": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error: %s", exc)
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    for r in (auth.router, users.router, rides.router, music.router, safety.router, devices.router,
              communication.router, ws_routes.router):
        app.include_router(r)

    @app.get("/api/health", tags=["system"])
    def health():
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ok", "server_time": utcnow().isoformat()}

    @app.get("/j/{code}", response_class=HTMLResponse, include_in_schema=False)
    def invite_landing(code: str):
        safe = "".join(c for c in code if c.isalnum())[:64]
        return f"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Join ride on RideOmeter</title>
<body style="background:#0B0C0E;color:#fff;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;padding:24px"><p style="color:#FF8A00;letter-spacing:.2em">RIDEOMETER</p>
<h1>You're invited to a ride</h1><p>Code <b style="font-size:28px;letter-spacing:.15em">{safe}</b></p>
<p><a style="color:#FF8A00" href="ridewave://join/{safe}">Open in RideOmeter</a></p></div></body>"""

    Path(s.media_dir).mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=s.media_dir), name="media")
    return app


app = create_app()
