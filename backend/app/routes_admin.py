from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_, desc
from typing import Optional, List
from datetime import datetime, timedelta
from passlib.context import CryptContext
from pydantic import BaseModel
from .database import get_db, Complaint, User, Reward, auto_assign_demo_reward, Worker, WorkOrder
from .routes_auth import get_current_user
from .templates import mapping as TEMPLATE_MAPPING

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class WorkerRegistration(BaseModel):
    name: str
    username: str
    email: str
    password: str
    phone: Optional[str] = None
    department: str
    skills: Optional[List[str]] = []

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


@router.get("/departments_summary")
async def get_departments_summary(
    days: int = 30,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """Return departments with sub-issue breakdown and counts by status using templates mapping.
    Structure:
    {
      departments: [
        { name, total, by_status: {...}, issues: [ { name, issue_category, counts: {pending,in_progress,resolved,total} } ] }
      ]
    }
    """
    days = max(1, min(days, 365))
    cutoff = datetime.utcnow() - timedelta(days=days)

    # Aggregate counts grouped by (category, status) and (subcategory, status)
    rows_cat = (
        db.query(Complaint.category, Complaint.status, func.count(Complaint.id))
        .filter(Complaint.created_at >= cutoff)
        .group_by(Complaint.category, Complaint.status)
        .all()
    )
    rows_sub = (
        db.query(Complaint.subcategory, Complaint.status, func.count(Complaint.id))
        .filter(Complaint.created_at >= cutoff)
        .group_by(Complaint.subcategory, Complaint.status)
        .all()
    )
    by_cat = {}
    for cat, status_value, cnt in rows_cat:
        if not cat:
            continue
        key = (cat, (status_value or "").lower())
        by_cat[key] = cnt
    # Build a case-insensitive subcategory map (handles simple plural/singular forms)
    by_sub = {}
    for sub, status_value, cnt in rows_sub:
        if not sub:
            continue
        norm = (sub or "").strip().lower()
        key = (norm, (status_value or "").lower())
        by_sub[key] = by_sub.get(key, 0) + cnt

    def variants(name: str) -> list[str]:
        n = (name or "").strip().lower()
        vs = {n}
        # simple singular/plural toggles
        if n.endswith("es"):
            vs.add(n[:-2])
        if n.endswith("s"):
            vs.add(n[:-1])
        else:
            vs.add(n + "s")
        return list(vs)

    def counts_for(sub_name: str, issue_category: str):
        # Prefer subcategory match (case-insensitive, simple plural variants); fallback to category-based counts
        p = i = r = 0
        for v in variants(sub_name):
            p += by_sub.get((v, "pending"), 0)
            i += by_sub.get((v, "in_progress"), 0)
            r += by_sub.get((v, "resolved"), 0)
        if (p + i + r) == 0 and issue_category:
            p = by_cat.get((issue_category, "pending"), 0)
            i = by_cat.get((issue_category, "in_progress"), 0)
            r = by_cat.get((issue_category, "resolved"), 0)
        return {"pending": p, "in_progress": i, "resolved": r, "total": p + i + r}

    # Build lookup sets from mapping
    mapped_categories = set()
    mapped_subcats = set()
    for dept_name, issues in TEMPLATE_MAPPING.items():
        for sub_name, data in issues.items():
            mapped_subcats.add(sub_name)
            cat = data.get("category")
            if cat:
                mapped_categories.add(cat)

    departments = []
    for dept_name, issues in TEMPLATE_MAPPING.items():
        dept_issues = []
        # Compute department totals using the same matching logic as /admin/department_issues:
        # any complaint whose subcategory (case-insensitive, with simple plural variants) is in the dept mapping OR
        # whose category matches any of the mapped categories.
        dept_cats = {data.get("category") for data in issues.values() if data.get("category")}
        norm_subs = set()
        for sub_name in issues.keys():
            for v in variants(sub_name):
                norm_subs.add(v)
        dept_totals = {"pending": 0, "in_progress": 0, "resolved": 0}
        if norm_subs or dept_cats:
            q = (
                db.query(Complaint.status, func.count(Complaint.id))
                .filter(Complaint.created_at >= cutoff)
            )
            conds = []
            if norm_subs:
                conds.append(func.lower(Complaint.subcategory).in_(list(norm_subs)))
            if dept_cats:
                conds.append(Complaint.category.in_(list(dept_cats)))
            q = q.filter(or_(*conds)).group_by(Complaint.status)
            for st, cnt in q.all():
                key = (st or "").lower()
                if key in dept_totals:
                    dept_totals[key] = cnt
        for sub_name, data in issues.items():
            issue_category = data.get("category")
            c = counts_for(sub_name, issue_category)
            dept_issues.append({
                "name": sub_name,
                "issue_category": issue_category,
                "priority": data.get("priority"),
                "counts": c,
            })
        dept_total = sum(dept_totals.values())
        departments.append({
            "name": dept_name,
            "total": dept_total,
            "by_status": dept_totals,
            "issues": sorted(dept_issues, key=lambda x: x["counts"]["total"], reverse=True),
        })

    # Sort departments by total desc
    departments.sort(key=lambda d: d["total"], reverse=True)

    # Compute Unmapped bucket
    # Rows whose subcategory and category are both not in mapping (or null)
    # Normalize sets for case-insensitive & trimmed comparisons
    def _norm(x: str) -> str:
        return (x or "").strip().lower()
    mapped_subcats_norm = {_norm(s) for s in mapped_subcats}
    mapped_categories_norm = {_norm(s) for s in mapped_categories}
    nm_cond = and_(
        or_(
            Complaint.subcategory.is_(None),
            ~func.lower(func.trim(Complaint.subcategory)).in_(list(mapped_subcats_norm)),
        ),
        or_(
            Complaint.category.is_(None),
            ~func.lower(func.trim(Complaint.category)).in_(list(mapped_categories_norm)),
        ),
    )
    rows_unmapped = (
        db.query(func.coalesce(Complaint.subcategory, Complaint.category).label("name"), Complaint.status, func.count(Complaint.id))
        .filter(Complaint.created_at >= cutoff)
        .filter(nm_cond)
        .group_by("name", Complaint.status)
        .all()
    )
    if rows_unmapped:
        # Aggregate per name
        agg: dict[str, dict[str, int]] = {}
        by_status_totals = {"pending": 0, "in_progress": 0, "resolved": 0}
        for name, status_value, cnt in rows_unmapped:
            nm = name or "Uncategorized"
            st = (status_value or "").lower()
            if nm not in agg:
                agg[nm] = {"pending": 0, "in_progress": 0, "resolved": 0}
            if st in agg[nm]:
                agg[nm][st] += cnt
        issues = []
        for nm, c in agg.items():
            total = (c.get("pending", 0) + c.get("in_progress", 0) + c.get("resolved", 0))
            issues.append({
                "name": nm,
                "issue_category": "Unmapped",
                "priority": None,
                "counts": {"pending": c.get("pending", 0), "in_progress": c.get("in_progress", 0), "resolved": c.get("resolved", 0), "total": total},
            })
            by_status_totals["pending"] += c.get("pending", 0)
            by_status_totals["in_progress"] += c.get("in_progress", 0)
            by_status_totals["resolved"] += c.get("resolved", 0)
        total_sum = by_status_totals["pending"] + by_status_totals["in_progress"] + by_status_totals["resolved"]
        if total_sum > 0:
            departments.append({
                "name": "Unmapped",
                "total": total_sum,
                "by_status": by_status_totals,
                "issues": sorted(issues, key=lambda x: x["counts"]["total"], reverse=True),
            })

    return {
        "success": True,
        "period_days": days,
        "departments": departments,
    }


@router.get("/department_issues")
async def get_department_issues(
    department: str,
    days: int = 30,
    status: Optional[str] = None,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """Return the full list of complaints (with details) for a given department for the last `days`.
    Department is one of the top-level keys in templates.mapping (e.g., "Roads & Transport").
    """
    days = max(1, min(days, 365))
    # Special Unmapped handling
    if department != "Unmapped" and department not in TEMPLATE_MAPPING:
        raise HTTPException(status_code=400, detail="Unknown department")

    # Build filter sets from mapping for mapped departments
    dept_issues = TEMPLATE_MAPPING.get(department, {}) if department != "Unmapped" else {}
    subcats = list(dept_issues.keys())
    categories = list({v.get("category") for v in dept_issues.values() if v.get("category")})

    cutoff = datetime.utcnow() - timedelta(days=days)

    # Use OUTER JOIN so complaints with missing users still appear
    q = db.query(Complaint, User).outerjoin(User, Complaint.user_id == User.id)
    q = q.filter(Complaint.created_at >= cutoff)
    if department == "Unmapped":
        # Build normalized sets of all mapped items (case-insensitive, trimmed)
        def _norm(x: str) -> str:
            return (x or "").strip().lower()
        mapped_categories = set()
        mapped_subcats = set()
        for _dept, issues in TEMPLATE_MAPPING.items():
            for sub_name, data in issues.items():
                mapped_subcats.add(_norm(sub_name))
                cat = data.get("category")
                if cat:
                    mapped_categories.add(_norm(cat))
        q = q.filter(
            and_(
                or_(Complaint.subcategory.is_(None), ~func.lower(func.trim(Complaint.subcategory)).in_(list(mapped_subcats))),
                or_(Complaint.category.is_(None), ~func.lower(func.trim(Complaint.category)).in_(list(mapped_categories))),
            )
        )
    else:
        # Match by subcategory primarily; also include any records whose category matches mapping
        q = q.filter((Complaint.subcategory.in_(subcats)) | (Complaint.category.in_(categories)))
    if status:
        q = q.filter(Complaint.status == status)
    q = q.order_by(Complaint.created_at.desc())

    rows = q.all()
    issues = []
    for comp, user in rows:
        issues.append({
            "id": comp.id,
            "subcategory": comp.subcategory,
            "category": comp.category,
            "description": comp.description,
            "status": comp.status,
            "priority": comp.priority,
            "image_url": comp.image_path,
            "location": {
                "latitude": comp.latitude,
                "longitude": comp.longitude,
                "address": comp.address,
            },
            "created_at": comp.created_at.isoformat(),
            "updated_at": comp.updated_at.isoformat(),
            "reporter": {
                "username": getattr(user, "username", None),
                "email": getattr(user, "email", None),
                "points": getattr(user, "points", 0),
                "demo_reward": getattr(user, "demo_reward", None),
            },
        })

    return {
        "success": True,
        "department": department,
        "period_days": days,
        "count": len(issues),
        "issues": issues,
    }


@router.post("/reclassify_issue")
async def reclassify_issue(
    complaint_id: int,
    department: str,
    subcategory: str,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db),
):
    """Manually assign an issue to a department/subcategory from the catalog.
    This updates the complaint's subcategory and category based on templates mapping,
    and optionally priority if available.
    """
    if department not in TEMPLATE_MAPPING or subcategory not in TEMPLATE_MAPPING[department]:
        raise HTTPException(status_code=400, detail="Invalid department/subcategory")
    comp = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Complaint not found")
    tpl = TEMPLATE_MAPPING[department][subcategory]
    try:
        comp.subcategory = subcategory
        comp.category = tpl.get("category") or comp.category
        if tpl.get("priority"):
            comp.priority = tpl.get("priority")
        comp.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(comp)
        return {
            "success": True,
            "complaint": {
                "id": comp.id,
                "category": comp.category,
                "subcategory": comp.subcategory,
                "priority": comp.priority,
                "updated_at": comp.updated_at.isoformat(),
            },
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to reclassify: {e}")


@router.get("/workers")
async def list_workers(
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """List all workers with their stats"""
    workers = (
        db.query(Worker, User)
        .join(User, Worker.user_id == User.id)
        .all()
    )
    
    result = []
    for worker, user in workers:
        result.append({
            "id": worker.id,
            "name": worker.name,
            "username": user.username,
            "email": user.email,
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
        })
    
    return {
        "success": True,
        "workers": result
    }


@router.post("/register_worker")
async def register_worker(
    worker_data: WorkerRegistration,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """Register a new worker/engineer"""
    # Check if username or email already exists
    existing_user = db.query(User).filter(
        (User.username == worker_data.username) | (User.email == worker_data.email)
    ).first()
    
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username or email already exists"
        )
    
    try:
        # Create user account
        new_user = User(
            username=worker_data.username,
            email=worker_data.email,
            password_hash=pwd_context.hash(worker_data.password),
            is_worker=True,
            is_admin=False
        )
        db.add(new_user)
        db.flush()  # Get the user ID
        
        # Create worker profile
        new_worker = Worker(
            user_id=new_user.id,
            name=worker_data.name,
            phone=worker_data.phone,
            department=worker_data.department,
            skills=worker_data.skills or [],
            active_status=True
        )
        db.add(new_worker)
        db.commit()
        
        return {
            "success": True,
            "message": f"Worker {worker_data.name} registered successfully",
            "worker": {
                "id": new_worker.id,
                "name": new_worker.name,
                "username": new_user.username,
                "email": new_user.email,
                "department": new_worker.department
            }
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to register worker: {str(e)}"
        )


@router.put("/toggle_worker_status/{worker_id}")
async def toggle_worker_status(
    worker_id: int,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """Toggle worker active status (activate/deactivate)"""
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    
    worker.active_status = not worker.active_status
    db.commit()
    
    return {
        "success": True,
        "message": f"Worker {'activated' if worker.active_status else 'deactivated'}",
        "worker": {
            "id": worker.id,
            "name": worker.name,
            "active_status": worker.active_status
        }
    }


@router.post("/assign_work")
async def assign_work_to_worker(
    complaint_id: int,
    worker_id: int,
    priority: str = "Medium",
    notes: str = "",
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """Assign a complaint to a worker"""
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    
    # Check if work order already exists
    existing_order = db.query(WorkOrder).filter(
        WorkOrder.complaint_id == complaint_id
    ).first()
    
    if existing_order:
        # Update existing work order
        existing_order.worker_id = worker_id
        existing_order.priority = priority
        existing_order.notes = notes
        existing_order.assigned_by = admin.id
        existing_order.updated_at = datetime.utcnow()
        work_order = existing_order
    else:
        # Create new work order
        work_order = WorkOrder(
            complaint_id=complaint_id,
            worker_id=worker_id,
            assigned_by=admin.id,
            priority=priority,
            notes=notes,
            status="assigned"
        )
        db.add(work_order)
    
    # Update complaint status
    complaint.status = "in_progress"
    complaint.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(work_order)
    
    return {
        "success": True,
        "message": f"Complaint #{complaint_id} assigned to worker {worker.name}",
        "work_order": {
            "id": work_order.id,
            "status": work_order.status,
            "priority": work_order.priority,
            "assigned_at": work_order.assigned_at.isoformat()
        }
    }


@router.get("/work_orders")
async def list_work_orders(
    status: Optional[str] = None,
    worker_id: Optional[int] = None,
    admin: User = Depends(is_admin),
    db: Session = Depends(get_db)
):
    """List work orders with filtering options"""
    query = (
        db.query(WorkOrder, Complaint, Worker, User.username)
        .join(Complaint, WorkOrder.complaint_id == Complaint.id)
        .outerjoin(Worker, WorkOrder.worker_id == Worker.id)
        .outerjoin(User, Complaint.user_id == User.id)
    )
    
    if status:
        query = query.filter(WorkOrder.status == status)
    if worker_id:
        query = query.filter(WorkOrder.worker_id == worker_id)
    
    work_orders = query.order_by(desc(WorkOrder.created_at)).all()
    
    result = []
    for work_order, complaint, worker, reporter_username in work_orders:
        result.append({
            "work_order_id": work_order.id,
            "status": work_order.status,
            "priority": work_order.priority,
            "assigned_at": work_order.assigned_at.isoformat(),
            "started_at": work_order.started_at.isoformat() if work_order.started_at else None,
            "completed_at": work_order.completed_at.isoformat() if work_order.completed_at else None,
            "notes": work_order.notes,
            "complaint": {
                "id": complaint.id,
                "category": complaint.category,
                "subcategory": complaint.subcategory,
                "description": complaint.description,
                "address": complaint.address,
                "reporter": reporter_username
            },
            "worker": {
                "id": worker.id if worker else None,
                "name": worker.name if worker else "Unassigned"
            }
        })
    
    return {
        "success": True,
        "work_orders": result
    }