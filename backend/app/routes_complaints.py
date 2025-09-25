from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, case
from pathlib import Path
import shutil
import uuid
import json
from typing import Optional, List
from datetime import datetime, timedelta
import io, math
from PIL import Image as PILImage
from .database import get_db, Complaint, User, Vote, auto_assign_demo_reward
POINTS_REPORT_CREATED = 10
POINTS_VOTE_CAST = 1
POINTS_RECEIVE_VOTE = 2
from .classifier import classify_image
from .templates import create_issue_report, mapping
from .routes_auth import get_current_user
try:
    import imagehash
except Exception:
    imagehash = None
try:
    from rapidfuzz.fuzz import token_set_ratio
except Exception:
    token_set_ratio = None

router = APIRouter(prefix="/complaints", tags=["Complaints"])

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Supported image formats
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def haversine_meters(lat1, lon1, lat2, lon2):
    if None in (lat1, lon1, lat2, lon2):
        return None
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def phash_hex_from_path(path: Path) -> str:
    if imagehash is None:
        return None
    with PILImage.open(path) as im:
        im = im.convert("RGB")
        h = imagehash.phash(im)
        return str(h)

def phash_hamming_dist(hex1: str, hex2: str) -> int:
    if not hex1 or not hex2:
        return 999
    return bin(int(hex1, 16) ^ int(hex2, 16)).count("1")

@router.get("/stats")
async def get_public_statistics(
    days: Optional[int] = 30,
    db: Session = Depends(get_db)
):
    """Public statistics for landing page and general dashboards.
    Returns totals over the last `days` (default 30). No auth required.
    """
    cutoff = datetime.utcnow() - timedelta(days=days) if days else None

    total_q = db.query(func.count(Complaint.id))
    resolved_q = db.query(func.count(Complaint.id)).filter(Complaint.status == "resolved")
    active_users_q = db.query(func.count(func.distinct(Complaint.user_id)))

    if cutoff:
        total_q = total_q.filter(Complaint.created_at >= cutoff)
        resolved_q = resolved_q.filter(Complaint.created_at >= cutoff)
        active_users_q = active_users_q.filter(Complaint.created_at >= cutoff)

    total = total_q.scalar() or 0
    resolved = resolved_q.scalar() or 0
    active_users = active_users_q.scalar() or 0

    return {
        "success": True,
        "period_days": days,
        "statistics": {
            "total_complaints": total,
            "resolved": resolved,
            "active_users": active_users,
        },
    }

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

@router.get("/catalog")
async def get_category_catalog(
    current_user: User = Depends(get_current_user)
):
    """Return a flattened catalog of all supported categories and subcategories from templates.mapping.
    Each item includes: issueType (group), subcategory (human label), issue_category (official), description, priority.
    """
    catalog = []
    for issue_type, issues in mapping.items():
        for subcat, data in issues.items():
            catalog.append({
                "issueType": issue_type,
                "subcategory": subcat,
                "issue_category": data.get("category"),
                "description": data.get("description"),
                "priority": data.get("priority"),
            })
    return {"success": True, "catalog": catalog}

@router.post("/raise")
async def raise_complaint(
    image: UploadFile = File(...),
    location: str = Form(None),
    description: str = Form(None),
    category_override: str = Form(None),
    subcategory_override: str = Form(None),
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

    file_path = None
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
        with PILImage.open(file_path) as im:
            img = im.convert("RGB")
        predicted_issue, confidence = classify_image(img)
        report = create_issue_report(predicted_issue, location_data)
        
        # Add confidence to metadata
        report["metadata"] = report.get("metadata", {})
        report["metadata"]["ai_confidence"] = confidence

        # Determine final category/subcategory/priority/description (apply user override when valid)
        final_category = report["issue_category"]
        # If resolver mapped it, set subcategory from that; otherwise keep predicted_issue text
        try:
            from .templates import resolve_prediction
            rp = resolve_prediction(predicted_issue)
            final_subcategory = rp[1] if rp else predicted_issue
        except Exception:
            final_subcategory = predicted_issue
        final_priority = report["priority_level"]
        final_description = description or report["detailed_description"]

        override_applied = False
        if subcategory_override:
            # Validate override against templates.mapping
            for issue_type, issues in mapping.items():
                if subcategory_override in issues:
                    data = issues[subcategory_override]
                    final_category = data.get("category", final_category)
                    final_subcategory = subcategory_override
                    # If user didn't provide a custom description, use template
                    if not description:
                        final_description = data.get("description", final_description)
                    # Align priority with template for the chosen subcategory
                    final_priority = data.get("priority", final_priority)
                    override_applied = True
                    break
        elif category_override:
            # Backward-safe: try to find a subcategory whose issue_category matches the provided category_override
            for issue_type, issues in mapping.items():
                for subcat, data in issues.items():
                    if data.get("category") == category_override:
                        final_category = data.get("category", final_category)
                        final_subcategory = subcat
                        if not description:
                            final_description = data.get("description", final_description)
                        final_priority = data.get("priority", final_priority)
                        override_applied = True
                        break
                if override_applied:
                    break

        # Duplicate detection
        latitude = location_data.get("latitude")
        longitude = location_data.get("longitude")
        new_phash = None
        try:
            new_phash = phash_hex_from_path(file_path)
        except Exception:
            new_phash = None

        # Search recent nearby complaints for duplicates
        duplicate_found = None
        if new_phash and (latitude is not None and longitude is not None):
            cutoff = datetime.utcnow() - timedelta(days=30)
            candidates = (
                db.query(Complaint)
                .filter(Complaint.created_at >= cutoff)
                .filter(Complaint.latitude.isnot(None))
                .filter(Complaint.longitude.isnot(None))
                .all()
            )

            best = None
            best_score = -1.0
            for c in candidates:
                dist_m = haversine_meters(latitude, longitude, c.latitude, c.longitude)
                if dist_m is None or dist_m > 400:  # 400m radius
                    continue
                hdist = phash_hamming_dist(new_phash, getattr(c, 'image_phash', None))
                if hdist > 10:
                    # try textual similarity as a backup if available
                    tscore = 0
                    if token_set_ratio and (description or final_description) and c.description:
                        base_desc = description or final_description
                        try:
                            tscore = token_set_ratio(base_desc, c.description)
                        except Exception:
                            tscore = 0
                    if tscore < 85:
                        continue
                    score = tscore
                else:
                    score = 100 - hdist

                if score > best_score:
                    best_score = score
                    best = c

            duplicate_found = best

        if duplicate_found:
            # Auto-vote for the user if not already voted
            existing = duplicate_found
            already_voted = (
                db.query(Vote).filter(Vote.user_id == current_user.id, Vote.complaint_id == existing.id).first()
            )
            if not already_voted:
                vote = Vote(user_id=current_user.id, complaint_id=existing.id)
                db.add(vote)
                existing.vote_count = (existing.vote_count or 0) + 1
                db.commit()
                db.refresh(existing)

            # Cleanup uploaded temp file, we won't use it now
            try:
                if file_path.exists():
                    file_path.unlink()
            except Exception:
                pass

            return {
                "success": True,
                "duplicate": True,
                "duplicate_of": existing.id,
                "vote_count": existing.vote_count or 0,
                "message": "Similar report found nearby. We've upvoted the existing report for you.",
            }

        # Create complaint record
        complaint = Complaint(
            user_id=current_user.id,
            category=final_category,
            subcategory=final_subcategory,
            description=final_description,
            image_path=f"/uploads/{filename}",
            latitude=location_data.get("latitude"),
            longitude=location_data.get("longitude"),
            address=location_data.get("address"),
            status="pending",
            priority=final_priority,
            image_phash=new_phash,
            ai_metadata={
                "ai_description": report["detailed_description"],
                "ai_confidence": confidence,
                "user_override": override_applied,
                "override_category": final_category if override_applied else None,
                "override_subcategory": final_subcategory if override_applied else None,
                "location_data": location_data
            }
        )
        
        db.add(complaint)
        # Award points to the reporting user
        try:
            current_user.points = (current_user.points or 0) + POINTS_REPORT_CREATED
            auto_assign_demo_reward(db, current_user, awarded_by="system")
        except Exception:
            pass
        db.commit()
        db.refresh(complaint)

        return {
            "success": True,
            "duplicate": False,
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
        if file_path and file_path.exists():
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
        # Custom priority ordering (Critical > High > Medium > Low) using SQLAlchemy case
        case_expr = case(
            (
                (Complaint.priority == "Critical", 4),
                (Complaint.priority == "High", 3),
                (Complaint.priority == "Medium", 2),
                (Complaint.priority == "Low", 1),
            ),
            else_=0,
        )
        query = query.order_by(case_expr.desc(), desc(Complaint.vote_count))
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
        # Award points: voter gets small points; owner gets more
        try:
            owner = db.query(User).filter(User.id == complaint.user_id).first()
            if owner:
                owner.points = (owner.points or 0) + POINTS_RECEIVE_VOTE
                auto_assign_demo_reward(db, owner, awarded_by="system")
            current_user.points = (current_user.points or 0) + POINTS_VOTE_CAST
            auto_assign_demo_reward(db, current_user, awarded_by="system")
        except Exception:
            pass
    
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

@router.delete("/{complaint_id}")
def delete_complaint(
    complaint_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Permanently delete a complaint that belongs to the current user (or if the user is admin).
    Removes associated votes and deletes the uploaded image file from disk.
    """
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    # Authorization: owner or admin
    is_owner = complaint.user_id == current_user.id
    is_admin = getattr(current_user, "is_admin", False)
    if not (is_owner or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to delete this complaint")

    # Delete image file if present
    try:
        if complaint.image_path:
            # image_path stored as "/uploads/<file>"
            rel = complaint.image_path.lstrip("/")
            abs_path = (UPLOADS_DIR.parent / rel).resolve()
            if abs_path.exists():
                abs_path.unlink()
    except Exception:
        # Proceed even if file removal fails
        pass

    # Delete associated votes first to maintain referential integrity
    db.query(Vote).filter(Vote.complaint_id == complaint.id).delete()

    # Delete the complaint
    db.delete(complaint)
    db.commit()

    return {"success": True, "deleted_id": complaint_id}
