from fastapi import APIRouter, Form, Depends
from sqlalchemy.orm import Session
from .database import get_db, User

router = APIRouter(prefix="/users", tags=["Users"])

@router.post("/register")
def register_user(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        return {"success": False, "message": "Username already exists"}
    user = User(username=username, password=password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"success": True, "message": f"User {username} registered successfully", "user_id": user.id}

@router.post("/login")
def login_user(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username, User.password == password).first()
    if user:
        return {"success": True, "message": "Login successful", "user_id": user.id, "username": user.username}
    return {"success": False, "message": "Invalid credentials"}
