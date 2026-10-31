from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_SECRET = "dev-only-insecure-secret-change-me-0123456789abcdef"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="RW_", extra="ignore")

    env: str = "development"
    app_name: str = "RideWave API"
    database_url: str = "sqlite:///./ridewave.db"
    public_base_url: str = "http://localhost:8030"
    cors_origins: list[str] = ["http://localhost:8081"]

    jwt_secret: str = _DEV_SECRET
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    password_reset_minutes: int = 30
    # Development convenience only: return the reset token in the API response
    # because no e-mail provider is configured. Must be False in production.
    expose_reset_token: bool = False

    livekit_url: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"

    spotify_client_id: str = ""

    stop_request_ttl_minutes: int = 10
    location_live_seconds: int = 60
    location_retention_days: int = 7
    media_dir: str = "./media"
    max_avatar_bytes: int = 2 * 1024 * 1024

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str) and not v.startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def _production_guards(self):
        if self.env == "production":
            if self.jwt_secret == _DEV_SECRET or len(self.jwt_secret) < 32:
                raise ValueError("RW_JWT_SECRET must be set to a strong secret in production")
            if self.expose_reset_token:
                raise ValueError("RW_EXPOSE_RESET_TOKEN must be false in production")
            if self.livekit_api_secret == "secret":
                raise ValueError("RW_LIVEKIT_API_SECRET must be set in production")
        return self

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
