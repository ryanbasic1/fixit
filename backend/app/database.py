from sqlalchemy import (
    create_engine, Column, Integer, String, ForeignKey,
    DateTime, Text, Boolean, Float, JSON
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "civic_ai.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_admin = Column(Boolean, default=False)
    points = Column(Integer, default=0)  # Reward points
    demo_reward = Column(String, default=None)  # Admin assigned demo reward/tier
    complaints = relationship("Complaint", back_populates="user")
    votes = relationship("Vote", back_populates="user")
    rewards = relationship("Reward", back_populates="user")

class Complaint(Base):
    __tablename__ = "complaints"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    category = Column(String, index=True)
    subcategory = Column(String, index=True)
    description = Column(Text)
    image_path = Column(String)
    image_phash = Column(String)  # perceptual hash for duplicate detection
    latitude = Column(Float)
    longitude = Column(Float)
    address = Column(String)
    status = Column(String, default="pending")
    priority = Column(String)
    ai_metadata = Column(JSON)
    vote_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="complaints")
    votes = relationship("Vote", back_populates="complaint")

def create_tables():
    Base.metadata.create_all(bind=engine)
    # Lightweight auto-migration for new columns on SQLite
    # Use exec_driver_sql to avoid SQLAlchemy 2.0 text execution restrictions and ensure commit
    try:
        print(f"[DB] Using SQLite at: {DB_PATH}")
        with engine.begin() as conn:
            res = conn.exec_driver_sql("PRAGMA table_info(users)")
            cols = {row[1] for row in res.fetchall()}
            if "points" not in cols:
                conn.exec_driver_sql("ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0")
                print("[DB] Migrated: added users.points (DEFAULT 0)")
            else:
                print("[DB] users.points already present")
            if "demo_reward" not in cols:
                conn.exec_driver_sql("ALTER TABLE users ADD COLUMN demo_reward TEXT")
                print("[DB] Migrated: added users.demo_reward (TEXT)")
            else:
                print("[DB] users.demo_reward already present")
    except Exception:
        # Non-fatal; allows server to start even if migration fails
        pass

class Vote(Base):
    __tablename__ = "votes"
    
    id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(Integer, ForeignKey("complaints.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    complaint = relationship("Complaint", back_populates="votes")
    user = relationship("User", back_populates="votes")


class Reward(Base):
    __tablename__ = "rewards"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    label = Column(String, nullable=False)
    description = Column(Text)
    points = Column(Integer)
    awarded_by = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="rewards")


def _compute_demo_tier(points: int | None, threshold: int = 200) -> str | None:
    pts = points or 0
    if pts >= threshold * 2:
        return "Gold"
    if pts >= threshold:
        return "Silver"
    return None


def auto_assign_demo_reward(db, user: User, *, awarded_by: str = "system", threshold: int = 200) -> None:
    """Assign/upgrade demo_reward tier automatically based on points.
    - Gold: >= 2x threshold, Silver: >= threshold, else: None
    - Idempotent: only updates when tier changes; creates a Reward entry when setting a tier.
    Note: Does not commit by itself; callers should commit the session.
    """
    try:
        new_tier = _compute_demo_tier(getattr(user, "points", 0), threshold)
        current = getattr(user, "demo_reward", None)
        if new_tier != current:
            user.demo_reward = new_tier
            if new_tier:
                db.add(Reward(user_id=user.id, label=new_tier, description="Auto-assigned demo reward", points=None, awarded_by=awarded_by))
    except Exception:
        # Best-effort; do not break the request flow if tiering fails
        pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
