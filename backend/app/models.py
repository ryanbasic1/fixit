from sqlalchemy import Column, Integer, String, DateTime, Float, JSON, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class Vote(Base):
    __tablename__ = "votes"
    
    id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(Integer, ForeignKey("complaints.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    complaint = relationship("Complaint", back_populates="votes")
    user = relationship("User", back_populates="votes")

# Update the Complaint model to include votes
class Complaint(Base):
    __tablename__ = "complaints"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    category = Column(String, index=True)
    subcategory = Column(String)
    description = Column(String)
    image_path = Column(String)
    status = Column(String, default="pending")
    priority = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    address = Column(String)
    ai_metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    vote_count = Column(Integer, default=0)  # New field for vote count

    user = relationship("User", back_populates="complaints")
    votes = relationship("Vote", back_populates="complaint")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    complaints = relationship("Complaint", back_populates="user")
    votes = relationship("Vote", back_populates="user")