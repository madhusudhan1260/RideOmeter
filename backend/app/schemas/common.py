from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PlainSerializer

from app.core.database import as_utc


def _iso(dt: datetime) -> str:
    return as_utc(dt).isoformat().replace("+00:00", "Z")


UTCDateTime = Annotated[datetime, AfterValidator(as_utc), PlainSerializer(_iso, return_type=str)]
Lat = Annotated[float, Field(ge=-90, le=90)]
Lng = Annotated[float, Field(ge=-180, le=180)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(BaseModel):
    detail: str
