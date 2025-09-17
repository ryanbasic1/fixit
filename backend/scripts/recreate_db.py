"""
Script to recreate the database with the new schema
"""
import os
import sys
from pathlib import Path

# Add the parent directory to Python path so we can import from app
sys.path.append(str(Path(__file__).parent.parent))

from app.database import Base, engine, DB_PATH

def recreate_database():
    # Delete existing database
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Deleted existing database at {DB_PATH}")
    
    # Create new database with updated schema
    Base.metadata.create_all(bind=engine)
    print(f"Created new database at {DB_PATH} with updated schema")

if __name__ == "__main__":
    recreate_database()