from fastapi import status


class AppError(Exception):
    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self, detail: str, *, extra: dict | None = None):
        super().__init__(detail)
        self.detail = detail
        self.extra = extra or {}


class BadRequest(AppError):
    status_code = status.HTTP_400_BAD_REQUEST


class Unauthorized(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED


class Forbidden(AppError):
    status_code = status.HTTP_403_FORBIDDEN


class NotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND


class Conflict(AppError):
    status_code = status.HTTP_409_CONFLICT


class ServiceUnavailable(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
