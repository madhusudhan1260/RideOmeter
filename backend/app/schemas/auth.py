import re

from pydantic import BaseModel, EmailStr, Field, field_validator

_USERNAME = re.compile(r"^[a-zA-Z0-9_.]{3,32}$")


def _strong_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("Password must contain letters and numbers")
    return v


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str = Field(max_length=128)
    display_name: str = Field(min_length=1, max_length=64)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        if not _USERNAME.match(v):
            raise ValueError("Username: 3–32 letters, digits, '_' or '.'")
        return v.lower()

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _strong_password(v)


class LoginRequest(BaseModel):
    # Email or username.
    identifier: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=200)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=200)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    detail: str
    # Only populated when RW_EXPOSE_RESET_TOKEN=true (local development without e-mail).
    dev_reset_token: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    new_password: str = Field(max_length=128)

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _strong_password(v)
