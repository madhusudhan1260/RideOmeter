import logging

from fastapi import APIRouter, Depends, Request, status

from app.core.config import get_settings
from app.core.permissions import DB, CurrentUser
from app.core.rate_limit import rate_limit
from app.schemas.auth import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenPair,
)
from app.schemas.common import Message
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger("ridewave.auth")


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("register", 5, 60))])
def register(data: RegisterRequest, db: DB, request: Request):
    user = auth_service.register(db, data, ip=_ip(request))
    return auth_service.issue_tokens(db, user, user_agent=request.headers.get("user-agent"))


@router.post("/login", response_model=TokenPair, dependencies=[Depends(rate_limit("login", 10, 60))])
def login(data: LoginRequest, db: DB, request: Request):
    return auth_service.login(db, data.identifier, data.password, _ip(request), request.headers.get("user-agent"))


@router.post("/refresh", response_model=TokenPair, dependencies=[Depends(rate_limit("refresh", 30, 60))])
def refresh(data: RefreshRequest, db: DB, request: Request):
    return auth_service.refresh(db, data.refresh_token, request.headers.get("user-agent"))


@router.post("/logout", response_model=Message)
def logout(data: LogoutRequest, db: DB, user: CurrentUser):
    auth_service.logout(db, user, data.refresh_token)
    return Message(detail="Signed out")


@router.post("/forgot-password", response_model=ForgotPasswordResponse,
             dependencies=[Depends(rate_limit("forgot", 5, 300))])
def forgot_password(data: ForgotPasswordRequest, db: DB):
    raw = auth_service.start_password_reset(db, data.email)
    resp = ForgotPasswordResponse(detail="If that e-mail is registered, a reset link has been sent.")
    if raw and get_settings().expose_reset_token:
        # No mail provider in local dev; surface the token so the flow is testable.
        resp.dev_reset_token = raw
    elif raw:
        log.info("password reset requested; configure an e-mail sender to deliver it")
    return resp


@router.post("/reset-password", response_model=Message, dependencies=[Depends(rate_limit("reset", 10, 300))])
def reset_password(data: ResetPasswordRequest, db: DB):
    auth_service.reset_password(db, data.token, data.new_password)
    return Message(detail="Password updated. Sign in with your new password.")
