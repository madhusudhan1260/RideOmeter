import uuid

from fastapi import APIRouter, File, UploadFile

from app.core.permissions import DB, CurrentUser
from app.schemas.user import MeOut, MeUpdate, PublicUserOut
from app.services import user_service

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=MeOut)
def me(user: CurrentUser):
    return user


@router.put("/me", response_model=MeOut)
def update_me(data: MeUpdate, db: DB, user: CurrentUser):
    return user_service.update_me(db, user, data)


@router.post("/me/avatar", response_model=MeOut)
async def upload_avatar(db: DB, user: CurrentUser, file: UploadFile = File(...)):
    content = await file.read(2 * 1024 * 1024 + 1)
    user_service.save_avatar(db, user, content)
    return user


@router.get("/{user_id}", response_model=PublicUserOut)
def get_user(user_id: uuid.UUID, db: DB, user: CurrentUser):
    return user_service.public_user(user_service.visible_user(db, user, user_id))
