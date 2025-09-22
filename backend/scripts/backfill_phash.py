from pathlib import Path
import sqlite3
from PIL import Image as PILImage
import os

# Attempt to import imagehash
try:
    import imagehash
except Exception as e:
    print("ERROR: imagehash is not installed. Please install ImageHash first.")
    raise

BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH = BASE_DIR / "data" / "civic_ai.db"
UPLOADS_DIR = BASE_DIR / "uploads"

def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    # Ensure column exists
    cur.execute("PRAGMA table_info(complaints)")
    cols = [row[1] for row in cur.fetchall()]
    if "image_phash" not in cols:
        print("The column image_phash does not exist. Run add_phash_column.py first.")
        conn.close()
        return

    # Fetch complaints missing phash
    cur.execute("SELECT id, image_path FROM complaints WHERE image_phash IS NULL OR image_phash = ''")
    rows = cur.fetchall()
    if not rows:
        print("No complaints require backfill.")
        conn.close()
        return

    updated = 0
    skipped = 0

    for cid, image_path in rows:
        try:
            if not image_path:
                skipped += 1
                continue
            # image_path is stored like "/uploads/<file>"; normalize to absolute
            rel = image_path.replace("/", os.sep)
            if rel.startswith(os.sep):
                rel = rel[1:]
            abs_path = BASE_DIR / rel
            if not abs_path.exists():
                print(f"Skip id={cid}: file not found {abs_path}")
                skipped += 1
                continue

            with PILImage.open(abs_path) as im:
                im = im.convert("RGB")
                h = imagehash.phash(im)
                ph = str(h)

            cur.execute("UPDATE complaints SET image_phash = ? WHERE id = ?", (ph, cid))
            updated += 1
        except Exception as e:
            print(f"Skip id={cid}: error {e}")
            skipped += 1

    conn.commit()
    conn.close()
    print(f"Backfill complete. Updated: {updated}, Skipped: {skipped}")

if __name__ == "__main__":
    main()
