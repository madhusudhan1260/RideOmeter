import enum


class RideStatus(str, enum.Enum):
    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"
    CANCELLED = "CANCELLED"


class RideVisibility(str, enum.Enum):
    PUBLIC = "PUBLIC"
    PRIVATE = "PRIVATE"


class ParticipantRole(str, enum.Enum):
    ADMIN = "ADMIN"
    CO_ADMIN = "CO_ADMIN"
    MEMBER = "MEMBER"


class ParticipantStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    LEFT = "LEFT"
    REMOVED = "REMOVED"


class VoiceMode(str, enum.Enum):
    OPEN_MIC = "OPEN_MIC"
    PUSH_TO_TALK = "PUSH_TO_TALK"
    ADMIN_ONLY = "ADMIN_ONLY"


class StopType(str, enum.Enum):
    PETROL = "PETROL"
    FOOD = "FOOD"
    TEA_COFFEE = "TEA_COFFEE"
    RESTROOM = "RESTROOM"
    REST = "REST"
    BREAKDOWN = "BREAKDOWN"
    EMERGENCY = "EMERGENCY"
    CUSTOM = "CUSTOM"


class StopStatus(str, enum.Enum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"
    EXPIRED = "EXPIRED"


OPEN_STOP_STATUSES = (StopStatus.OPEN, StopStatus.ACKNOWLEDGED, StopStatus.APPROVED)
TERMINAL_STOP_STATUSES = (StopStatus.REJECTED, StopStatus.COMPLETED, StopStatus.EXPIRED)


class EmergencyType(str, enum.Enum):
    SOS = "SOS"
    ACCIDENT = "ACCIDENT"
    BREAKDOWN = "BREAKDOWN"
    ASSISTANCE = "ASSISTANCE"


class EmergencyStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


class MusicSource(str, enum.Enum):
    LOCAL = "LOCAL"
    SPOTIFY = "SPOTIFY"


class MusicState(str, enum.Enum):
    PLAYING = "PLAYING"
    PAUSED = "PAUSED"
    STOPPED = "STOPPED"


class MusicAction(str, enum.Enum):
    PLAY = "PLAY"
    PAUSE = "PAUSE"
    NEXT = "NEXT"
    PREVIOUS = "PREVIOUS"
    QUEUE = "QUEUE"
    ENABLE = "ENABLE"
    DISABLE = "DISABLE"


class DevicePlatform(str, enum.Enum):
    ANDROID = "ANDROID"
    IOS = "IOS"


class CommunicationKind(str, enum.Enum):
    LIVEKIT = "LIVEKIT"
    NEARBY = "NEARBY"


class SyncResult(str, enum.Enum):
    ACCEPTED = "ACCEPTED"
    DUPLICATE = "DUPLICATE"
    REJECTED = "REJECTED"


class NotificationType(str, enum.Enum):
    RIDER_JOINED = "RIDER_JOINED"
    RIDER_LEFT = "RIDER_LEFT"
    RIDE_STARTED = "RIDE_STARTED"
    RIDE_ENDED = "RIDE_ENDED"
    STOP_REQUESTED = "STOP_REQUESTED"
    EMERGENCY = "EMERGENCY"
    ANNOUNCEMENT = "ANNOUNCEMENT"
    ROUTE_CHANGED = "ROUTE_CHANGED"
