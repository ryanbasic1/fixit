from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime, timedelta
from .database import get_db, Complaint, User, Reward, auto_assign_demo_reward
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
    query = db.query(Complaint).options(joinedload(Complaint.user))
    
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
                "user": {
                    "username": getattr(c.user, "username", None) if c.user else None,
                    "email": getattr(c.user, "email", None) if c.user else None,
                    "points": getattr(c.user, "points", 0) if c.user else 0,
                    "demo_reward": getattr(c.user, "demo_reward", None) if c.user else None,
                },
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
        meta = complaint.ai_metadata or {}
        try:
            # Ensure dict in case stored JSON is None or invalid
            if not isinstance(meta, dict):
                meta = {}
        except Exception:
            meta = {}
        meta["admin_notes"] = admin_notes
        complaint.ai_metadata = meta
    
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
    category: Optional[str] = None,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """Get statistics about complaints with optional category filter."""
    cutoff = datetime.utcnow() - timedelta(days=days)

    base_filter = [Complaint.created_at >= cutoff]
    if category:
        base_filter.append(Complaint.category == category)

    # Total complaints in period
    total = db.query(func.count(Complaint.id)).filter(*base_filter).scalar()

    # Complaints by status
    status_counts = (
        db.query(Complaint.status, func.count(Complaint.id).label("count"))
        .filter(*base_filter)
        .group_by(Complaint.status)
        .all()
    )

    # Complaints by category (ignores category filter if given to still provide distribution)
    # If you prefer to respect the filter, add it to the query below.
    category_counts = (
        db.query(Complaint.category, func.count(Complaint.id).label("count"))
        .filter(Complaint.created_at >= cutoff)
        .group_by(Complaint.category)
        .all()
    )

    # Active users in period
    active_users = (
        db.query(func.count(func.distinct(Complaint.user_id)))
        .filter(*base_filter)
        .scalar()
    )

    return {
        "success": True,
        "period_days": days,
        "statistics": {
            "total_complaints": total,
            "active_users": active_users,
            "by_status": {status: count for status, count in status_counts},
            "by_category": {category: count for category, count in category_counts},
        },
    }

@router.post("/grant-points")
async def grant_points(
    username: str,
    points: int,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    if points == 0:
        return {"success": True, "message": "No change"}
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        user.points = (user.points or 0) + points
        auto_assign_demo_reward(db, user, awarded_by=admin.username)
        db.commit()
        db.refresh(user)
        return {"success": True, "username": user.username, "points": user.points}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to grant points: {e}")


@router.post("/recalculate-points")
async def recalculate_points(
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """Recalculate reward points from historical data for all users.
    Points formula:
    - +10 per report created
    - +2 per vote received on owned reports
    - +1 per vote cast
    """
    # Reports per user
    reports = dict(
        db.query(Complaint.user_id, func.count(Complaint.id))
        .group_by(Complaint.user_id)
        .all()
    )

    # Votes received per owner (join complaints -> votes)
    votes_received = dict(
        db.query(Complaint.user_id, func.count())
        .select_from(Complaint)
        .join("votes")
        .group_by(Complaint.user_id)
        .all()
    )

    # Votes cast per user
    from .database import Vote  # local import to avoid cycle at module load
    votes_cast = dict(
        db.query(Vote.user_id, func.count(Vote.id)).group_by(Vote.user_id).all()
    )

    updated = []
    users = db.query(User).all()
    for u in users:
        r = reports.get(u.id, 0)
        vr = votes_received.get(u.id, 0)
        vc = votes_cast.get(u.id, 0)
        points = (r * 10) + (vr * 2) + (vc * 1)
        u.points = points
        auto_assign_demo_reward(db, u, awarded_by=admin.username)
        updated.append({
            "username": u.username,
            "reports": r,
            "votes_received": vr,
            "votes_cast": vc,
            "points": points,
        })
    db.commit()

    total_points = sum(item["points"] for item in updated)
    return {
        "success": True,
        "updated_users": len(updated),
        "total_points": total_points,
        "details": updated,
    }


@router.get("/users")
async def list_users(
    min_points: int | None = None,
    max_points: int | None = None,
    sort: str = "points_desc",
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    q = db.query(User)
    if min_points is not None:
        q = q.filter(User.points >= min_points)
    if max_points is not None:
        q = q.filter(User.points <= max_points)
    if sort == "points_asc":
        q = q.order_by(User.points.asc())
    elif sort == "username_asc":
        q = q.order_by(User.username.asc())
    elif sort == "username_desc":
        q = q.order_by(User.username.desc())
    else:
        q = q.order_by(User.points.desc())
    users = q.all()
    return {
        "success": True,
        "users": [
            {
                "username": u.username,
                "email": u.email,
                "points": u.points or 0,
                "demo_reward": getattr(u, "demo_reward", None),
                "is_admin": getattr(u, "is_admin", False),
            }
            for u in users
        ],
    }


@router.post("/assign-demo-reward")
async def assign_demo_reward(
    username: str,
    reward: str,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    u = db.query(User).filter(User.username == username).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.demo_reward = reward
    # Also create a Reward entry so the user can see it in their rewards list
    db.add(Reward(user_id=u.id, label=reward, description="Admin assigned demo reward", points=None, awarded_by=admin.username))
    db.commit()
    return {"success": True, "username": username, "demo_reward": reward}


@router.post("/assign-demo-rewards-auto")
async def assign_demo_rewards_auto(
    threshold: int = 200,
    top_tier: str = "Gold",
    mid_tier: str = "Silver",
    low_tier: str = "Bronze",
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """Auto-assign demo rewards based on points.
    - >= threshold*2: top_tier
    - >= threshold: mid_tier
    - else: None (or low_tier if you want everyone categorized)
    """
    users = db.query(User).all()
    updated = []
    for u in users:
        pts = u.points or 0
        tier: str | None = None
        if pts >= threshold * 2:
            tier = top_tier
        elif pts >= threshold:
            tier = mid_tier
        else:
            # If you want to assign everyone a tier, uncomment next line
            # tier = low_tier
            tier = None
        if tier != getattr(u, "demo_reward", None):
            u.demo_reward = tier
            updated.append({"username": u.username, "points": pts, "demo_reward": tier})
            if tier:
                db.add(Reward(user_id=u.id, label=tier, description="Auto-assigned demo reward", points=None, awarded_by=admin.username))
    db.commit()
    return {"success": True, "updated": updated, "updated_count": len(updated)}


@router.post("/grant-reward")
async def grant_reward(
    username: str,
    label: str,
    description: str | None = None,
    points: int | None = None,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    u = db.query(User).filter(User.username == username).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    reward = Reward(
        user_id=u.id,
        label=label,
        description=description,
        points=points,
        awarded_by=admin.username,
    )
    db.add(reward)
    # Optionally add points to the user balance if points provided
    if isinstance(points, int) and points != 0:
        u.points = (u.points or 0) + points
    db.commit()
    db.refresh(reward)
    return {
        "success": True,
        "reward": {
            "id": reward.id,
            "username": username,
            "label": reward.label,
            "description": reward.description,
            "points": reward.points,
            "awarded_by": reward.awarded_by,
            "created_at": reward.created_at.isoformat(),
        },
    }


@router.get("/rewards")
async def list_rewards(
    username: Optional[str] = None,
    limit: int = 200,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """List recent rewards; optionally filter by username."""
    q = db.query(Reward, User.username).join(User, Reward.user_id == User.id)
    if username:
        q = q.filter(User.username == username)
    q = q.order_by(Reward.created_at.desc())
    if limit:
        q = q.limit(min(max(limit, 1), 1000))
    rows = q.all()
    return {
        "success": True,
        "rewards": [
            {
                "id": r.id,
                "username": uname,
                "label": r.label,
                "description": r.description,
                "points": r.points,
                "awarded_by": r.awarded_by,
                "created_at": r.created_at.isoformat(),
            }
            for (r, uname) in rows
        ],
    }


@router.delete("/rewards/{reward_id}")
async def delete_reward(
    reward_id: int,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """Delete a reward; if it had points, subtract from the user and retier automatically."""
    reward = db.query(Reward).filter(Reward.id == reward_id).first()
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found")
    user = db.query(User).filter(User.id == reward.user_id).first()
    if not user:
        # If user missing (shouldn't happen), just delete reward
        db.delete(reward)
        db.commit()
        return {"success": True, "deleted": reward_id}
    try:
        # Reverse points if applicable
        if isinstance(reward.points, int) and reward.points != 0:
            user.points = max(0, (user.points or 0) - reward.points)
            auto_assign_demo_reward(db, user, awarded_by=admin.username)
        db.delete(reward)
        db.commit()
        return {"success": True, "deleted": reward_id, "username": user.username, "points": user.points}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete reward: {e}")


@router.get("/timeseries")
async def get_timeseries(
    days: int = 30,
    category: Optional[str] = None,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """Return per-day counts for complaints by status over the last `days`.
    Structure:
    { dates: [YYYY-MM-DD...], pending: [...], in_progress: [...], resolved: [...] }
    """
    days = max(1, min(days, 365))
    cutoff = datetime.utcnow() - timedelta(days=days)

    day_label = func.date(Complaint.created_at)
    q = (
        db.query(day_label.label("day"), Complaint.status, func.count(Complaint.id))
        .filter(Complaint.created_at >= cutoff)
    )
    if category:
        q = q.filter(Complaint.category == category)
    rows = (
        q.group_by("day", Complaint.status)
        .order_by("day")
        .all()
    )

    # Build continuous date axis
    dates = []
    day = datetime.utcnow().date() - timedelta(days=days - 1)
    today = datetime.utcnow().date()
    while day <= today:
        dates.append(day.strftime("%Y-%m-%d"))
        day += timedelta(days=1)

    # Initialize series
    series = {
        "pending": {d: 0 for d in dates},
        "in_progress": {d: 0 for d in dates},
        "resolved": {d: 0 for d in dates},
    }

    for d, status_value, count in rows:
        key = (status_value or "").lower()
        date_str = str(d)
        if date_str in series.get(key, {}):
            series[key][date_str] = count

    result = {
        "success": True,
        "period_days": days,
        "series": {
            "dates": dates,
            "pending": [series["pending"][d] for d in dates],
            "in_progress": [series["in_progress"][d] for d in dates],
            "resolved": [series["resolved"][d] for d in dates],
        },
    }
    return result


@router.get("/category_status")
async def get_category_status(
    days: int = 30,
    top: int = 8,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """Return per-category counts split by status for the last `days` (top N categories)."""
    days = max(1, min(days, 365))
    top = max(1, min(top, 50))
    cutoff = datetime.utcnow() - timedelta(days=days)

    # Aggregate counts by category and status
    rows = (
        db.query(Complaint.category, Complaint.status, func.count(Complaint.id))
        .filter(Complaint.created_at >= cutoff)
        .group_by(Complaint.category, Complaint.status)
        .all()
    )

    # Sum totals per category for sorting
    totals = {}
    for cat, _status, cnt in rows:
        if cat is None:
            continue
        totals[cat] = totals.get(cat, 0) + cnt

    # Select top categories by total count
    sorted_cats = sorted(totals.items(), key=lambda x: x[1], reverse=True)
    top_categories = [c for c, _ in sorted_cats[:top]]

    # Initialize series structures
    series = {
        "pending": {c: 0 for c in top_categories},
        "in_progress": {c: 0 for c in top_categories},
        "resolved": {c: 0 for c in top_categories},
    }

    for cat, status_value, cnt in rows:
        if cat not in top_categories:
            continue
        key = (status_value or "").lower()
        if key in series and cat in series[key]:
            series[key][cat] = cnt

    result = {
        "success": True,
        "period_days": days,
        "categories": top_categories,
        "series": {
            "pending": [series["pending"][c] for c in top_categories],
            "in_progress": [series["in_progress"][c] for c in top_categories],
            "resolved": [series["resolved"][c] for c in top_categories],
        },
    }
    return result