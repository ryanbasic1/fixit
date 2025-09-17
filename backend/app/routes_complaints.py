from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from pathlib import Path
import shutil
import uuid
import json
from typing import Optional, List
from datetime import datetime, timedelta
from PIL import Image as PILImage
from .database import get_db, Complaint, User, Vote
from .classifier import classify_image
from .templates import create_issue_report
from .routes_auth import get_current_user

router = APIRouter(prefix="/complaints", tags=["Complaints"])

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Supported image formats
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

@router.get("/categories")
async def get_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get list of unique categories from complaints"""
    categories = db.query(Complaint.category).distinct().all()
    return {
        "success": True,
        "categories": [cat[0] for cat in categories if cat[0]]
    }

@router.post("/raise")
async def raise_complaint(
    image: UploadFile = File(...),
    location: str = Form(None),
    description: str = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Validate image format
    file_ext = Path(image.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format. Allowed formats: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    try:
        # Save image with unique name
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path = UPLOADS_DIR / filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)

        # Process location data if provided
        location_data = {}
        if location:
            try:
                location_data = json.loads(location)
            except json.JSONDecodeError:
                location_data = {"address": location}

        # Classify image and generate report
        img = PILImage.open(file_path).convert("RGB")
        predicted_issue, confidence = classify_image(img)
        report = create_issue_report(predicted_issue, location_data)
        
        # Add confidence to metadata
        report["metadata"] = report.get("metadata", {})
        report["metadata"]["ai_confidence"] = confidence

        # Create complaint record
        complaint = Complaint(
            user_id=current_user.id,
            category=report["issue_category"],
            subcategory=predicted_issue,
            description=description or report["detailed_description"],
            image_path=f"/uploads/{filename}",
            latitude=location_data.get("latitude"),
            longitude=location_data.get("longitude"),
            address=location_data.get("address"),
            status="pending",
            priority=report["priority_level"],
            ai_metadata={
                "ai_description": report["detailed_description"],
                "location_data": location_data
            }
        )
        
        db.add(complaint)
        db.commit()
        db.refresh(complaint)

        return {
            "success": True,
            "complaint": {
                "id": complaint.id,
                "category": complaint.category,
                "subcategory": complaint.subcategory,
                "description": complaint.description,
                "image_url": complaint.image_path,
                "status": complaint.status,
                "priority": complaint.priority,
                "location": {
                    "latitude": complaint.latitude,
                    "longitude": complaint.longitude,
                    "address": complaint.address
                },
                "created_at": complaint.created_at.isoformat()
            }
        }

    except Exception as e:
        # Clean up uploaded file if something goes wrong
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process complaint: {str(e)}"
        )

@router.get("/my")
def get_my_complaints(
    current_user: User = Depends(get_current_user),
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get complaints for the current user with optional status filter"""
    # Ensure we only get complaints for the current user
    query = db.query(Complaint).filter(Complaint.user_id == current_user.id)
    
    if status:
        query = query.filter(Complaint.status == status)
    
    complaints = query.order_by(Complaint.created_at.desc()).all()
    
    return {
        "success": True,
        "complaints": [
            {
                "id": c.id,
                "category": c.category,
                "subcategory": c.subcategory,
                "description": c.description,
                "status": c.status,
                "priority": c.priority,
                "image_url": c.image_path,
                "location": {
                    "latitude": c.latitude,
                    "longitude": c.longitude,
                    "address": c.address
                },
                "vote_count": c.vote_count,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
                "user": {"username": c.user.username}
            } for c in complaints
        ]
    }

@router.get("/public")
async def get_public_complaints(
    days: Optional[int] = 30,
    category: Optional[str] = None,
    sort_by: Optional[str] = "latest",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all public complaints with optional filters"""
    query = db.query(Complaint)
    
    # Apply time filter
    if days:
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        query = query.filter(Complaint.created_at >= cutoff_date)
    
    # Apply category filter
    if category:
        query = query.filter(Complaint.category == category)
    
    # Apply sorting
    if sort_by == "votes":
        query = query.order_by(desc(Complaint.vote_count))
    elif sort_by == "priority":
        # Custom priority ordering (Critical > High > Medium > Low)
        priority_case = {
            "Critical": 4,
            "High": 3,
            "Medium": 2,
            "Low": 1
        }
        query = query.order_by(
            func.case(priority_case, value=Complaint.priority).desc(),
            desc(Complaint.vote_count)
        )
    else:  # default to latest
        query = query.order_by(desc(Complaint.created_at))

    complaints = query.all()
    
    # Check which complaints the current user has voted on
    voted_complaints = {
        vote.complaint_id 
        for vote in db.query(Vote).filter(Vote.user_id == current_user.id).all()
    }

    return {
        "success": True,
        "complaints": [
            {
                "id": c.id,
                "category": c.category,
                "subcategory": c.subcategory,
                "description": c.description,
                "status": c.status,
                "priority": c.priority,
                "image_url": c.image_path,
                "location": {
                    "latitude": c.latitude,
                    "longitude": c.longitude,
                    "address": c.address
                },
                "vote_count": c.vote_count,
                "has_voted": c.id in voted_complaints,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
                "user": {"username": c.user.username}
            } for c in complaints
        ]
    }

@router.post("/vote/{complaint_id}")
async def vote_complaint(
    complaint_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Vote for a complaint"""
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    
    # Check if user has already voted
    existing_vote = db.query(Vote).filter(
        Vote.complaint_id == complaint_id,
        Vote.user_id == current_user.id
    ).first()
    
    if existing_vote:
        # Remove vote if already voted
        db.delete(existing_vote)
        complaint.vote_count -= 1
        action = "removed"
    else:
        # Add new vote
        new_vote = Vote(complaint_id=complaint_id, user_id=current_user.id)
        db.add(new_vote)
        complaint.vote_count += 1
        action = "added"
    
    db.commit()
    
    return {
        "success": True,
        "action": action,
        "vote_count": complaint.vote_count
    }

@router.get("/{complaint_id}")
def get_complaint_details(
    complaint_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get detailed information about a specific complaint"""
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
        
    if complaint.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this complaint")
    
    return {
        "success": True,
        "complaint": {
            "id": complaint.id,
            "category": complaint.category,
            "subcategory": complaint.subcategory,
            "description": complaint.description,
            "status": complaint.status,
            "priority": complaint.priority,
            "image_url": complaint.image_path,
            "location": {
                "latitude": complaint.latitude,
                "longitude": complaint.longitude,
                "address": complaint.address
            },
            "metadata": complaint.ai_metadata,
            "created_at": complaint.created_at.isoformat(),
            "updated_at": complaint.updated_at.isoformat()
        }
    }
