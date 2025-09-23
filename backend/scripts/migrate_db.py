import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "civic_ai.db"


def column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def add_points_column(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    if not column_exists(cur, "users", "points"):
        cur.execute("ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0")
        conn.commit()
        print("[OK] Added 'points' column to 'users' with DEFAULT 0")
    else:
        print("[SKIP] 'users.points' already exists")


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists():
        print(f"[WARN] Database not found at {DB_PATH}. Start the app once to create it, then re-run this script if needed.")
    conn = sqlite3.connect(str(DB_PATH))
    try:
        add_points_column(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
