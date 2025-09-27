#!/usr/bin/env python3
"""
Debug script to check worker user creation
"""
import sys
from pathlib import Path

# Add the parent directory to sys.path so we can import from app
sys.path.append(str(Path(__file__).parent))

from app.database import get_db, User, Worker
from sqlalchemy.orm import Session

def check_worker_user():
    """Check if the worker user exists and has correct flags"""
    db = next(get_db())
    
    # Check for user "yashpagar"
    user = db.query(User).filter(User.username == "yashpagar").first()
    
    if not user:
        print("❌ User 'yashpagar' not found in database")
        return
    
    print(f"✅ User found: {user.username}")
    print(f"   Email: {user.email}")
    print(f"   is_admin: {user.is_admin}")
    print(f"   is_worker: {user.is_worker}")
    print(f"   Created: {user.created_at}")
    
    # Check for worker profile
    worker = db.query(Worker).filter(Worker.user_id == user.id).first()
    
    if not worker:
        print("❌ No worker profile found for this user")
        return
    
    print(f"✅ Worker profile found:")
    print(f"   Name: {worker.name}")
    print(f"   Department: {worker.department}")
    print(f"   Phone: {worker.phone}")
    print(f"   Active: {worker.active_status}")
    print(f"   Skills: {worker.skills}")
    
    print("\n🔍 Login Test:")
    from app.routes_auth import verify_password
    test_password = "123"
    if verify_password(test_password, user.password_hash):
        print(f"✅ Password verification successful for '{test_password}'")
    else:
        print(f"❌ Password verification failed for '{test_password}'")
        print(f"   Stored hash: {user.password_hash[:50]}...")

if __name__ == "__main__":
    check_worker_user()