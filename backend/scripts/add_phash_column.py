import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "civic_ai.db"

def column_exists(cursor, table, column):
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())

def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    if not column_exists(cur, "complaints", "image_phash"):
        cur.execute("ALTER TABLE complaints ADD COLUMN image_phash TEXT")
        conn.commit()
        print("Added image_phash column to complaints.")
    else:
        print("image_phash column already exists.")
    conn.close()

if __name__ == "__main__":
    main()
