"""
Recalculate reward points from historical data and store into users.points.

Formula:
- +10 per report created (Complaint rows)
- +2 per vote received on owned complaints (Complaint <- Vote join)
- +1 per vote cast (Vote rows by user)
"""
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BACKEND_DIR))

from app.database import SessionLocal, User, Complaint, Vote  # type: ignore
from sqlalchemy import func


def main():
    db = SessionLocal()
    try:
        reports = dict(
            db.query(Complaint.user_id, func.count(Complaint.id))
            .group_by(Complaint.user_id)
            .all()
        )
        votes_received = dict(
            db.query(Complaint.user_id, func.count())
            .select_from(Complaint)
            .join(Vote, Vote.complaint_id == Complaint.id)
            .group_by(Complaint.user_id)
            .all()
        )
        votes_cast = dict(
            db.query(Vote.user_id, func.count(Vote.id)).group_by(Vote.user_id).all()
        )

        print("Recalculating points...")
        total_points = 0
        for u in db.query(User).all():
            r = reports.get(u.id, 0)
            vr = votes_received.get(u.id, 0)
            vc = votes_cast.get(u.id, 0)
            points = (r * 10) + (vr * 2) + (vc * 1)
            u.points = points
            total_points += points
            print(
                f"{u.username:20s} | reports={r:3d} votes_recv={vr:3d} votes_cast={vc:3d} -> points={points:4d}"
            )
        db.commit()
        print(f"\nUpdated users: {db.query(User).count()}, total points assigned: {total_points}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
