from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc, func
from typing import Optional, List
from datetime import datetime, timedelta
from pathlib import Path
import shutil
import uuid
from PIL import Image as PILImage

from .database import get_db, User, Worker, WorkOrder, WorkUpdate, Complaint
from .routes_auth import get_current_user

router = APIRouter(prefix="/worker", tags=["Worker"])

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"

def is_worker(user: User = Depends(get_current_user)):
    """Check if the current user is a worker"""
    if not getattr(user, "is_worker", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Worker access required"
        )
    return user

@router.get("/profile")
async def get_worker_profile(
    worker_user: User = Depends(is_worker),
    db: Session = Depends(get_db)
):
    """Get worker profile information"""
    worker = db.query(Worker).filter(Worker.user_id == worker_user.id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    
    return {
        "success": True,
        "worker": {
            "id": worker.id,
            "name": worker.name,
            "phone": worker.phone,
            "department": worker.department,
            "skills": worker.skills or [],
            "active_status": worker.active_status,
            "rating": worker.rating,
            "completed_jobs": worker.completed_jobs,
            "current_location": {
                "latitude": worker.current_location_lat,
                "longitude": worker.current_location_lng
            }
        }
    }

@router.get("/assignments")
async def get_worker_assignments(
    status: Optional[str] = None,
    department_filter: Optional[bool] = True,
    worker_user: User = Depends(is_worker),
    db: Session = Depends(get_db)
):
    """Get work assignments for the current worker filtered by department/skills"""
    worker = db.query(Worker).filter(Worker.user_id == worker_user.id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    
    # Get department-to-category mapping
    department_categories = {
        "Roads & Infrastructure": ["Road Infrastructure Issue", "Traffic Safety Issue", "Pedestrian Safety Issue", "Traffic Control System Failure"],
        "Water & Sewerage": ["Water Infrastructure Issue", "Water Service Disruption", "Drainage System Issue", "Sanitation Emergency", "Public Safety Hazard"],
        "Electricity & Power": ["Public Lighting Issue", "Electrical Infrastructure Damage", "Electrical Safety Hazard"],
        "Waste Management": ["Waste Management Issue"],
        "Street Lighting": ["Public Lighting Issue"],
        "Parks & Recreation": ["Public Amenity Damage", "Public Space Maintenance"],
        "Public Safety": ["Public Safety Hazard"],
        "Building & Construction": ["Building Infrastructure"],
        "Transportation": ["Traffic Control System Failure", "Traffic Safety Issue"],
        "Environmental Services": ["Public Health Emergency"]
    }
    
    # Build base query - show both assigned work orders AND available complaints
    if department_filter and worker.department:
        relevant_categories = department_categories.get(worker.department, [])
        
        # Get assigned work orders for this worker
        assigned_query = (
            db.query(WorkOrder, Complaint, User)
            .join(Complaint, WorkOrder.complaint_id == Complaint.id)
            .join(User, Complaint.user_id == User.id)
            .filter(WorkOrder.worker_id == worker.id)
        )
        
        # Get available complaints (no work order yet) that match department
        available_query = (
            db.query(Complaint, User)
            .join(User, Complaint.user_id == User.id)
            .outerjoin(WorkOrder, WorkOrder.complaint_id == Complaint.id)
            .filter(
                WorkOrder.id.is_(None),  # No work order exists yet
                Complaint.status.in_(["pending", "under_review"]),  # Available statuses
                (func.lower(Complaint.category).in_([cat.lower() for cat in relevant_categories]) |
                 func.lower(Complaint.subcategory).in_([cat.lower() for cat in relevant_categories]))
            )
        )
        
        if status:
            if status == "available":
                # Only show available complaints
                assigned_results = []
                available_results = available_query.order_by(desc(Complaint.created_at)).limit(10).all()
            else:
                # Only show assigned work orders with the specified status
                assigned_results = assigned_query.filter(WorkOrder.status == status).order_by(desc(WorkOrder.created_at)).all()
                available_results = []
        else:
            # Show active assignments by default + available complaints
            assigned_results = assigned_query.filter(WorkOrder.status.in_(["assigned", "in_progress"])).order_by(desc(WorkOrder.created_at)).all()
            available_results = available_query.order_by(desc(Complaint.created_at)).limit(10).all()
        
    else:
        # Show only directly assigned work orders
        assigned_query = (
            db.query(WorkOrder, Complaint, User)
            .join(Complaint, WorkOrder.complaint_id == Complaint.id)
            .join(User, Complaint.user_id == User.id)
            .filter(WorkOrder.worker_id == worker.id)
        )
        
        if status:
            assigned_query = assigned_query.filter(WorkOrder.status == status)
        else:
            assigned_query = assigned_query.filter(WorkOrder.status.in_(["assigned", "in_progress"]))
        
        assigned_results = assigned_query.order_by(desc(WorkOrder.created_at)).all()
        available_results = []
    
    result = []
    
    # Process assigned work orders
    for work_order, complaint, reporter in assigned_results:
        result.append({
            "work_order_id": work_order.id,
            "status": work_order.status,
            "priority": work_order.priority,
            "assigned_at": work_order.assigned_at.isoformat(),
            "estimated_completion": work_order.estimated_completion.isoformat() if work_order.estimated_completion else None,
            "materials_needed": work_order.materials_needed,
            "notes": work_order.notes,
            "complaint": {
                "id": complaint.id,
                "category": complaint.category,
                "subcategory": complaint.subcategory,
                "description": complaint.description,
                "image_url": complaint.image_path,
                "location": {
                    "latitude": complaint.latitude,
                    "longitude": complaint.longitude,
                    "address": complaint.address
                },
                "created_at": complaint.created_at.isoformat()
            },
            "reporter": {
                "username": reporter.username,
                "email": reporter.email
            }
        })
    
    # Process available complaints (no work order yet)
    for complaint, reporter in available_results:
        result.append({
            "work_order_id": None,  # No work order yet
            "status": "available",
            "priority": complaint.priority or "medium",
            "assigned_at": None,
            "estimated_completion": None,
            "materials_needed": None,
            "notes": None,
            "complaint": {
                "id": complaint.id,
                "category": complaint.category,
                "subcategory": complaint.subcategory,
                "description": complaint.description,
                "image_url": complaint.image_path,
                "location": {
                    "latitude": complaint.latitude,
                    "longitude": complaint.longitude,
                    "address": complaint.address
                },
                "created_at": complaint.created_at.isoformat()
            },
            "reporter": {
                "username": reporter.username,
                "email": reporter.email
            }
        })
    
    return {
        "success": True,
        "assignments": result
    }

@router.post("/update/{work_order_id}")
async def update_work_progress(
    work_order_id: int,
    status: str = Form(...),
    description: str = Form(""),
    photo: Optional[UploadFile] = File(None),
    location_lat: Optional[float] = Form(None),
    location_lng: Optional[float] = Form(None),
    worker_user: User = Depends(is_worker),
    db: Session = Depends(get_db)
):
    """Update work progress with status, description, and optional photo"""
    worker = db.query(Worker).filter(Worker.user_id == worker_user.id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    
    work_order = db.query(WorkOrder).filter(
        WorkOrder.id == work_order_id,
        WorkOrder.worker_id == worker.id
    ).first()
    
    if not work_order:
        raise HTTPException(status_code=404, detail="Work order not found")
    
    # Handle photo upload
    photo_path = None
    if photo and photo.filename:
        file_ext = Path(photo.filename).suffix.lower()
        if file_ext in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
            filename = f"work_update_{uuid.uuid4()}{file_ext}"
            file_path = UPLOADS_DIR / filename
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(photo.file, buffer)
            photo_path = f"/uploads/{filename}"
    
    # Update work order status and timestamps
    work_order.status = status
    work_order.updated_at = datetime.utcnow()
    
    if status == "in_progress" and not work_order.started_at:
        work_order.started_at = datetime.utcnow()
    elif status == "completed" and not work_order.completed_at:
        work_order.completed_at = datetime.utcnow()
        # Update complaint status
        complaint = db.query(Complaint).filter(Complaint.id == work_order.complaint_id).first()
        if complaint:
            complaint.status = "resolved"
            complaint.updated_at = datetime.utcnow()
        # Update worker stats
        worker.completed_jobs = (worker.completed_jobs or 0) + 1
    
    # Create work update record
    work_update = WorkUpdate(
        work_order_id=work_order_id,
        worker_id=worker.id,
        status=status,
        description=description,
        photo_path=photo_path,
        location_lat=location_lat,
        location_lng=location_lng
    )
    
    db.add(work_update)
    db.commit()
    db.refresh(work_update)
    
    return {
        "success": True,
        "message": f"Work order updated to {status}",
        "work_update": {
            "id": work_update.id,
            "status": work_update.status,
            "description": work_update.description,
            "photo_url": work_update.photo_path,
            "created_at": work_update.created_at.isoformat()
        }
    }

@router.get("/history")
async def get_work_history(
    limit: int = 50,
    worker_user: User = Depends(is_worker),
    db: Session = Depends(get_db)
):
    """Get completed work history for the worker"""
    worker = db.query(Worker).filter(Worker.user_id == worker_user.id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    
    completed_orders = (
        db.query(WorkOrder, Complaint)
        .join(Complaint, WorkOrder.complaint_id == Complaint.id)
        .filter(WorkOrder.worker_id == worker.id)
        .filter(WorkOrder.status == "completed")
        .order_by(desc(WorkOrder.completed_at))
        .limit(limit)
        .all()
    )
    
    history = []
    for work_order, complaint in completed_orders:
        history.append({
            "work_order_id": work_order.id,
            "completed_at": work_order.completed_at.isoformat(),
            "complaint": {
                "id": complaint.id,
                "category": complaint.category,
                "subcategory": complaint.subcategory,
                "description": complaint.description,
                "address": complaint.address
            }
        })
    
    return {
        "success": True,
        "history": history,
        "total_completed": worker.completed_jobs or 0
    }

@router.post("/location")
async def update_worker_location(
    latitude: float,
    longitude: float,
    worker_user: User = Depends(is_worker),
    db: Session = Depends(get_db)
):
    """Update worker's current location"""
    worker = db.query(Worker).filter(Worker.user_id == worker_user.id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    
    worker.current_location_lat = latitude
    worker.current_location_lng = longitude
    db.commit()
    
    return {
        "success": True,
        "message": "Location updated successfully"
    }

@router.post("/claim/{complaint_id}")
async def claim_assignment(
    complaint_id: int,
    worker_user: User = Depends(is_worker),
    db: Session = Depends(get_db)
):
    """Claim a complaint as a work assignment"""
    worker = db.query(Worker).filter(Worker.user_id == worker_user.id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    
    # Check if complaint exists and is not already assigned
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    
    # Check if already has a work order
    existing_order = db.query(WorkOrder).filter(WorkOrder.complaint_id == complaint_id).first()
    if existing_order:
        raise HTTPException(status_code=400, detail="This issue is already assigned")
    
    # Create new work order
    work_order = WorkOrder(
        complaint_id=complaint_id,
        worker_id=worker.id,
        assigned_by=worker_user.id,  # Self-assigned
        status="assigned",
        priority=complaint.priority or "medium",
        notes=f"Self-assigned by {worker.name}"
    )
    
    db.add(work_order)
    complaint.status = "assigned"
    complaint.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(work_order)
    
    return {
        "success": True,
        "message": "Assignment claimed successfully",
        "work_order_id": work_order.id
    }