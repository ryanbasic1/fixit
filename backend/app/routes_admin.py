from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime, timedelta
from .database import get_db, Complaint, User
from .routes_auth import get_current_user

router = APIRouter(prefix="/admin", tags=["Admin"])

def is_admin(user: User = Depends(get_current_user)):
    """Check if the current user is an admin"""
    if not getattr(user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return user

@router.get("/complaints")
async def list_all_complaints(
    status: Optional[str] = None,
    category: Optional[str] = None,
    days: Optional[int] = None,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """List all complaints with optional filters"""
    query = db.query(Complaint)
    
    if status:
        query = query.filter(Complaint.status == status)
    if category:
        query = query.filter(Complaint.category == category)
    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        query = query.filter(Complaint.created_at >= cutoff)
    
    complaints = query.order_by(Complaint.created_at.desc()).all()
    
    return {
        "success": True,
        "complaints": [
            {
                "id": c.id,
                "user_id": c.user_id,
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
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat()
            } for c in complaints
        ]
    }

@router.put("/complaints/{complaint_id}")
async def update_complaint_status(
    complaint_id: int,
    status: str,
    admin_notes: Optional[str] = None,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """Update the status of a complaint"""
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    
    complaint.status = status
    complaint.updated_at = datetime.utcnow()
    
    if admin_notes:
        metadata = complaint.metadata or {}
        metadata["admin_notes"] = admin_notes
        complaint.metadata = metadata
    
    db.commit()
    db.refresh(complaint)
    
    return {
        "success": True,
        "message": f"Complaint {complaint_id} updated to status: {status}",
        "complaint": {
            "id": complaint.id,
            "status": complaint.status,
            "updated_at": complaint.updated_at.isoformat()
        }
    }

@router.get("/statistics")
async def get_statistics(
    days: Optional[int] = 30,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """Get statistics about complaints"""
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    # Total complaints in period
    total = db.query(func.count(Complaint.id))\
        .filter(Complaint.created_at >= cutoff).scalar()
    
    # Complaints by status
    status_counts = db.query(
        Complaint.status,
        func.count(Complaint.id).label("count")
    ).filter(Complaint.created_at >= cutoff)\
        .group_by(Complaint.status).all()
    
    # Complaints by category
    category_counts = db.query(
        Complaint.category,
        func.count(Complaint.id).label("count")
    ).filter(Complaint.created_at >= cutoff)\
        .group_by(Complaint.category).all()
    
    # Active users in period
    active_users = db.query(func.count(func.distinct(Complaint.user_id)))\
        .filter(Complaint.created_at >= cutoff).scalar()
    
    return {
        "success": True,
        "period_days": days,
        "statistics": {
            "total_complaints": total,
            "active_users": active_users,
            "by_status": {
                status: count for status, count in status_counts
            },
            "by_category": {
                category: count for category, count in category_counts
            }
        }
    }