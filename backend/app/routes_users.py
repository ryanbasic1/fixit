from fastapi import APIRouter, Form, Depends
from sqlalchemy.orm import Session
from .database import get_db, User, Reward
from .routes_auth import get_current_user

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


@router.get("/rewards")
def get_my_rewards(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rewards = (
        db.query(Reward)
        .filter(Reward.user_id == current_user.id)
        .order_by(Reward.created_at.desc())
        .all()
    )
    payload = {
        "success": True,
        "rewards": [
            {
                "id": r.id,
                "label": r.label,
                "description": r.description,
                "points": r.points,
                "awarded_by": r.awarded_by,
                "created_at": r.created_at.isoformat(),
            }
            for r in rewards
        ],
    }
    # If no rewards yet but user has a demo_reward tier, surface it as a virtual entry (no id)
    if not payload["rewards"] and getattr(current_user, "demo_reward", None):
        payload["rewards"].append({
            "id": None,
            "label": current_user.demo_reward,
            "description": "Admin assigned demo reward",
            "points": None,
            "awarded_by": None,
            "created_at": current_user.created_at.isoformat() if getattr(current_user, "created_at", None) else None,
        })
    return payload
