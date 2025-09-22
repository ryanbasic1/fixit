import argparse
import sys
from pathlib import Path
import sqlite3

# Ensure we can import from backend/app
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BACKEND_DIR))

from app.database import SessionLocal, User  # type: ignore

try:
	from passlib.context import CryptContext
except Exception as e:
	print("passlib is required. Please install dependencies from requirements.txt")
	raise

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

DB_PATH = BACKEND_DIR / "data" / "civic_ai.db"


def ensure_is_admin_column():
	"""Add is_admin column to users if missing (SQLite)."""
	conn = sqlite3.connect(str(DB_PATH))
	try:
		cur = conn.cursor()
		cur.execute("PRAGMA table_info(users)")
		cols = [row[1] for row in cur.fetchall()]
		if "is_admin" not in cols:
			cur.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0")
			conn.commit()
			print("Added is_admin column to users table.")
	finally:
		conn.close()


def get_or_create_admin(username: str, password: str | None, set_password: bool, email: str | None, promote: bool):
	ensure_is_admin_column()
	db = SessionLocal()
	try:
		user = db.query(User).filter(User.username == username).first()
		if user:
			changed = False
			if promote and not getattr(user, "is_admin", False):
				user.is_admin = True
				changed = True
				print(f"Promoted existing user '{username}' to admin.")
			if set_password and password:
				user.password_hash = pwd_context.hash(password)
				changed = True
				print(f"Updated password for user '{username}'.")
			if changed:
				db.commit()
			else:
				print("No changes made (user already admin and no password update requested).")
			return user
		else:
			if not password:
				raise SystemExit("User does not exist. Provide --password to create a new admin user.")
			user = User(
				username=username,
				email=email or f"{username}@example.com",
				password_hash=pwd_context.hash(password),
				is_admin=True,
			)
			db.add(user)
			db.commit()
			db.refresh(user)
			print(f"Created new admin user '{username}'.")
			return user
	finally:
		db.close()


def main():
	parser = argparse.ArgumentParser(description="Create or promote an admin user")
	parser.add_argument("--username", required=True, help="Username of the admin")
	parser.add_argument("--password", help="Password (required when creating a new user)")
	parser.add_argument("--email", help="Email address (optional)")
	parser.add_argument("--promote", action="store_true", help="Promote existing user to admin")
	parser.add_argument("--set-password", action="store_true", help="Update password for existing user")
	args = parser.parse_args()

	get_or_create_admin(
		username=args.username,
		password=args.password,
		set_password=args.set_password,
		email=args.email,
		promote=args.promote or True,  # default to promote/create as admin
	)


if __name__ == "__main__":
	main()

