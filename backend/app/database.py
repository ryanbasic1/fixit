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
    is_worker = Column(Boolean, default=False)
    points = Column(Integer, default=0)  # Reward points
    demo_reward = Column(String, default=None)  # Admin assigned demo reward/tier
    complaints = relationship("Complaint", back_populates="user")
    votes = relationship("Vote", back_populates="user")
    rewards = relationship("Reward", back_populates="user")

class Worker(Base):
    __tablename__ = "workers"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    name = Column(String, nullable=False)
    phone = Column(String)
    department = Column(String)
    skills = Column(JSON)  # List of skills/specializations
    active_status = Column(Boolean, default=True)
    current_location_lat = Column(Float)
    current_location_lng = Column(Float)
    rating = Column(Float, default=0.0)
    completed_jobs = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User")
    work_orders = relationship("WorkOrder", back_populates="worker")

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
    work_orders = relationship("WorkOrder", back_populates="complaint")

class WorkOrder(Base):
    __tablename__ = "work_orders"
    id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(Integer, ForeignKey("complaints.id"), nullable=False)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)
    assigned_by = Column(Integer, ForeignKey("users.id"))
    status = Column(String, default="assigned")  # assigned, in_progress, completed, cancelled
    priority = Column(String)
    estimated_completion = Column(DateTime)
    materials_needed = Column(Text)
    actual_cost = Column(Float)
    notes = Column(Text)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    complaint = relationship("Complaint", back_populates="work_orders")
    worker = relationship("Worker", back_populates="work_orders")
    updates = relationship("WorkUpdate", back_populates="work_order")

class WorkUpdate(Base):
    __tablename__ = "work_updates"
    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=False)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=False)
    status = Column(String)
    description = Column(Text)
    photo_path = Column(String)
    location_lat = Column(Float)
    location_lng = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    work_order = relationship("WorkOrder", back_populates="updates")
    worker = relationship("Worker")

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
            if "is_worker" not in cols:
                conn.exec_driver_sql("ALTER TABLE users ADD COLUMN is_worker BOOLEAN DEFAULT FALSE")
                print("[DB] Migrated: added users.is_worker (DEFAULT FALSE)")
            else:
                print("[DB] users.is_worker already present")
    except Exception:
        # Non-fatal; allows server to start even if migration fails
        pass

def create_demo_worker():
    """Create demo worker account if it doesn't exist"""
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    
    db = SessionLocal()
    try:
        # Check if demo worker already exists
        existing_user = db.query(User).filter(User.username == "worker").first()
        if not existing_user:
            # Create demo worker user
            demo_user = User(
                username="worker",
                email="worker@snapfixit.com",
                password_hash=pwd_context.hash("123"),
                is_worker=True
            )
            db.add(demo_user)
            db.commit()
            db.refresh(demo_user)
            
            # Create worker profile
            demo_worker = Worker(
                user_id=demo_user.id,
                name="Road Engineer Demo",
                phone="+1234567890",
                department="Roads & Infrastructure",
                skills=["Road Repair", "Pothole Filling", "Streetlight Maintenance", "Traffic Management", "Sidewalk Repair"],
                active_status=True
            )
            db.add(demo_worker)
            db.commit()
            print("[DB] Created demo worker account: username='worker', password='123'")
        else:
            # Update existing worker profile if needed
            existing_worker = db.query(Worker).filter(Worker.user_id == existing_user.id).first()
            if existing_worker:
                # Update to new department and skills
                existing_worker.name = "Road Engineer Demo"
                existing_worker.department = "Roads & Infrastructure"
                existing_worker.skills = ["Road Repair", "Pothole Filling", "Streetlight Maintenance", "Traffic Management", "Sidewalk Repair"]
                db.commit()
                print("[DB] Updated demo worker to Roads & Infrastructure department")
            else:
                # Create worker profile for existing user
                demo_worker = Worker(
                    user_id=existing_user.id,
                    name="Road Engineer Demo",
                    phone="+1234567890",
                    department="Roads & Infrastructure",
                    skills=["Road Repair", "Pothole Filling", "Streetlight Maintenance", "Traffic Management", "Sidewalk Repair"],
                    active_status=True
                )
                db.add(demo_worker)
                db.commit()
                print("[DB] Created worker profile for existing demo user")
    except Exception as e:
        print(f"[DB] Error creating demo worker: {e}")
    finally:
        db.close()

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
