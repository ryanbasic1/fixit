#!/usr/bin/env python3
"""
Fix worker user login issue for yashpagar
"""
import sys
from pathlib import Path

# Add the parent directory to sys.path so we can import from app
sys.path.append(str(Path(__file__).parent))

from app.database import SessionLocal, User, Worker
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def fix_worker_login():
    """Fix the worker login for yashpagar"""
    db = SessionLocal()
    try:
        # Check for worker first
        worker = db.query(Worker).filter(Worker.name == "yash rajendra pagar").first()
        if not worker:
            print("❌ Worker 'yash rajendra pagar' not found")
            return
        
        print(f"✅ Worker found: {worker.name} (ID: {worker.id})")
        print(f"   Department: {worker.department}")
        print(f"   User ID: {worker.user_id}")
        
        # Check for corresponding user
        user = db.query(User).filter(User.id == worker.user_id).first()
        if not user:
            print("❌ No user account found for this worker")
            print("Creating user account...")
            
            # Create the missing user account
            new_user = User(
                username="yashpagar",
                email="yashpaga123@gmail.com",
                password_hash=pwd_context.hash("123"),
                is_worker=True,
                is_admin=False
            )
            db.add(new_user)
            db.commit()
            db.refresh(new_user)
            
            # Update worker to point to new user
            worker.user_id = new_user.id
            db.commit()
            
            print(f"✅ Created user account: {new_user.username}")
            return
        
        print(f"✅ User account found: {user.username}")
        print(f"   Email: {user.email}")
        print(f"   is_worker: {user.is_worker}")
        print(f"   is_admin: {user.is_admin}")
        
        # Test password
        if pwd_context.verify("123", user.password_hash):
            print("✅ Password '123' is correct")
        else:
            print("❌ Password '123' is incorrect, fixing...")
            user.password_hash = pwd_context.hash("123")
            db.commit()
            print("✅ Password fixed")
        
        # Ensure is_worker is set
        if not user.is_worker:
            print("❌ User is not marked as worker, fixing...")
            user.is_worker = True
            db.commit()
            print("✅ User marked as worker")
        
        print("\n🎉 Worker login should now work!")
        
    finally:
        db.close()

if __name__ == "__main__":
    fix_worker_login()