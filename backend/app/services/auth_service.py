import logging
import uuid
from datetime import timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import as_utc, utcnow
from app.core.errors import Conflict, Unauthorized
from app.core.security import (
    create_access_token,
    hash_password,
    needs_rehash,
    new_opaque_token,
    sha256_hex,
    verify_password,
)
from app.models import PasswordResetToken, RefreshToken, User, UserProfile
from app.schemas.auth import RegisterRequest, TokenPair
from app.services.audit import audit

log = logging.getLogger("ridewave.auth")

# Verified against when the user does not exist so timing doesn't reveal accounts.
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password-1")


def register(db: Session, data: RegisterRequest, ip: str | None = None) -> User:
    email = data.email.lower()
    exists = db.scalar(select(User).where(or_(func.lower(User.email) == email, User.username == data.username)))
    if exists:
        raise Conflict("Email or username is already registered")
    user = User(email=email, username=data.username, password_hash=hash_password(data.password))
    user.profile = UserProfile(display_name=data.display_name.strip(), notification_prefs={}, audio_prefs={})
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("Email or username is already registered") from exc
    audit(db, "auth.register", actor_id=user.id, ip=ip)
    db.commit()
    return user


def authenticate(db: Session, identifier: str, password: str) -> User:
    ident = identifier.strip().lower()
    user = db.scalar(select(User).where(or_(func.lower(User.email) == ident, User.username == ident)))
    if user is None:
        verify_password(_DUMMY_HASH, password)
        raise Unauthorized("Incorrect email/username or password")
    if not verify_password(user.password_hash, password) or not user.is_active:
        raise Unauthorized("Incorrect email/username or password")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_at = utcnow()
    return user


def issue_tokens(
    db: Session, user: User, family_id: uuid.UUID | None = None, user_agent: str | None = None
) -> TokenPair:
    s = get_settings()
    access, expires_in = create_access_token(user.id)
    raw = new_opaque_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=sha256_hex(raw),
            family_id=family_id or uuid.uuid4(),
            expires_at=utcnow() + timedelta(days=s.refresh_token_days),
            user_agent=(user_agent or "")[:255] or None,
        )
    )
    db.commit()
    return TokenPair(access_token=access, refresh_token=raw, expires_in=expires_in)


def login(db: Session, identifier: str, password: str, ip: str | None, user_agent: str | None) -> TokenPair:
    user = authenticate(db, identifier, password)
    audit(db, "auth.login", actor_id=user.id, ip=ip)
    return issue_tokens(db, user, user_agent=user_agent)


def _revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def refresh(db: Session, raw_token: str, user_agent: str | None = None) -> TokenPair:
    """Rotate a refresh token. Re-use of an already-rotated token revokes the
    whole family (the token was probably stolen)."""
    token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256_hex(raw_token)))
    if token is None:
        raise Unauthorized("Invalid refresh token")
    if token.revoked_at is not None:
        raise Unauthorized("Refresh token revoked")
    if token.used_at is not None:
        log.warning("refresh token reuse detected user=%s family=%s", token.user_id, token.family_id)
        _revoke_family(db, token.family_id)
        audit(db, "auth.refresh_reuse", actor_id=token.user_id)
        db.commit()
        raise Unauthorized("Refresh token reuse detected; please sign in again")
    if as_utc(token.expires_at) <= utcnow():
        raise Unauthorized("Refresh token expired")
    user = db.get(User, token.user_id)
    if user is None or not user.is_active:
        raise Unauthorized("Account disabled")
    token.used_at = utcnow()
    return issue_tokens(db, user, family_id=token.family_id, user_agent=user_agent)


def logout(db: Session, user: User, raw_token: str) -> None:
    token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256_hex(raw_token)))
    if token is not None and token.user_id == user.id:
        _revoke_family(db, token.family_id)
    audit(db, "auth.logout", actor_id=user.id)
    db.commit()


def start_password_reset(db: Session, email: str) -> str | None:
    """Returns the raw token (for delivery) or None if no such account.
    Callers must answer identically in both cases."""
    user = db.scalar(select(User).where(func.lower(User.email) == email.lower()))
    if user is None or not user.is_active:
        return None
    raw = new_opaque_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=sha256_hex(raw),
            expires_at=utcnow() + timedelta(minutes=get_settings().password_reset_minutes),
        )
    )
    audit(db, "auth.reset_requested", actor_id=user.id)
    db.commit()
    return raw


def reset_password(db: Session, raw_token: str, new_password: str) -> None:
    prt = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == sha256_hex(raw_token)))
    if prt is None or prt.used_at is not None or as_utc(prt.expires_at) <= utcnow():
        raise Unauthorized("Reset link is invalid or has expired")
    user = db.get(User, prt.user_id)
    if user is None:
        raise Unauthorized("Reset link is invalid or has expired")
    user.password_hash = hash_password(new_password)
    prt.used_at = utcnow()
    # Sign out every session.
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    audit(db, "auth.password_reset", actor_id=user.id)
    db.commit()
