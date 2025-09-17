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
    complaints = relationship("Complaint", back_populates="user")
    votes = relationship("Vote", back_populates="user")

class Complaint(Base):
    __tablename__ = "complaints"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    category = Column(String, index=True)
    subcategory = Column(String, index=True)
    description = Column(Text)
    image_path = Column(String)
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

class Vote(Base):
    __tablename__ = "votes"
    
    id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(Integer, ForeignKey("complaints.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    complaint = relationship("Complaint", back_populates="votes")
    user = relationship("User", back_populates="votes")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
