import uuid

from sqlalchemy.orm import Session

from app.models import AuditLog


def audit(
    db: Session,
    action: str,
    *,
    actor_id: uuid.UUID | None = None,
    ride_id: uuid.UUID | None = None,
    ip: str | None = None,
    **detail,
) -> None:
    """Stage an audit row; it commits with the caller's transaction."""
    clean = {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in detail.items()}
    db.add(AuditLog(action=action, actor_id=actor_id, ride_id=ride_id, ip=ip, detail=clean))
