from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, status
from PIL import Image
from .classifier import classify_image
from .templates import create_issue_report
from .routes_auth import get_current_user
from .database import User
import shutil, uuid
from pathlib import Path

router = APIRouter(prefix="/classifier", tags=["Classifier"])
UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Supported image formats
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

@router.post("/analyze")
async def analyze_image(
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """Analyze image and return AI predictions without creating a complaint"""
    # Validate image format
    file_ext = Path(image.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format. Allowed formats: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    try:
        # Save image temporarily with unique name
        filename = f"temp_{uuid.uuid4()}{file_ext}"
        file_path = UPLOADS_DIR / filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)

        # Classify image and generate report
        img = Image.open(file_path).convert("RGB")
        predicted_issue, confidence = classify_image(img)
        report = create_issue_report(predicted_issue, {})
        
        # Add confidence to metadata
        report["metadata"] = report.get("metadata", {})
        report["metadata"]["ai_confidence"] = confidence
        
        # Clean up temporary file
        file_path.unlink()

        return {
            "success": True,
            "analysis": {
                "predicted_issue": predicted_issue,
                "confidence": confidence,
                "category": report["issue_category"],
                "description": report["detailed_description"],
                "priority": report["priority_level"]
            }
        }

    except Exception as e:
        # Clean up temporary file if something goes wrong
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze image: {str(e)}"
        )

@router.post("/classify")
async def classify_upload(image: UploadFile = File(...), lat: float = None, lng: float = None):
    file_ext = image.filename.split(".")[-1]
    filename = f"{uuid.uuid4()}.{file_ext}"
    file_path = UPLOADS_DIR / filename
    with open(file_path, "wb") as f:
        shutil.copyfileobj(image.file, f)

    predicted_issue = classify_image(Image.open(file_path))
    user_location = {"lat": lat, "lng": lng, "address": "User Location", "city": "Unknown", "area": "Unknown"}
    report = create_issue_report(predicted_issue, user_location)
    report["image_url"] = f"/uploads/{filename}"
    report["title"] = report["issue_category"]
    report["description"] = report["detailed_description"]

    return report
