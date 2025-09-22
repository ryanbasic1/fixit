from PIL import Image
import logging
from pathlib import Path
import json
import numpy
from .templates import mapping, prediction_mapping, create_issue_report

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import CLIP
try:
    from transformers import CLIPProcessor, CLIPModel
    import torch
    _clip_available = True
    logger.info("CLIP model available")
except ImportError as e:
    _clip_available = False
    CLIPProcessor = None
    CLIPModel = None
    logger.warning(f"CLIP model not available: {str(e)}")

# Initialize model and processor
model, processor = None, None
labels, label_to_category_issue = [], {}

# Cache file for predictions
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)
PREDICTIONS_CACHE = CACHE_DIR / "predictions.json"

# Load cached predictions if they exist
cached_predictions = {}

NON_CIVIC_TEXT_LABELS = [
    "a selfie photo of a person",
    "a portrait of a person",
    "an indoor selfie",
    "a photo of a pet (dog or cat)",
    "a random object not a civic issue",
    "a plate of food",
]

if _clip_available:
    try:
        model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
        
        # Build labels from the mapping structure
        for category, issues in mapping.items():
            for issue_name, issue_data in issues.items():
                text_prompt = f"a photo of {issue_name.lower()}"
                labels.append(text_prompt)
                label_to_category_issue[text_prompt] = (category, issue_name)
        # Add non-civic prompts
        for txt in NON_CIVIC_TEXT_LABELS:
            labels.append(txt)
            label_to_category_issue[txt] = ("non_civic", "non_civic")
    except Exception as e:
        logger.warning(f"Failed to load CLIP model: {e}")
        _clip_available = False

def classify_image(image: Image.Image):
    """
    Classify an image using CLIP model or fallback to rule-based classification.
    Returns a tuple of (category, confidence_score)
    """
    try:
        if _clip_available and model and processor and labels:
            # Generate image embedding
            inputs = processor(text=labels, images=image, return_tensors="pt", padding=True)
            
            with torch.no_grad():  # No need to track gradients for inference
                outputs = model(**inputs)
            
            # Get probabilities and predictions
            probs = outputs.logits_per_image.softmax(dim=1).detach().cpu().numpy()[0]
            pred_idx = probs.argmax()
            confidence = float(probs[pred_idx])  # Convert to Python float
            pred_label = labels[pred_idx]
            
            # Get category and issue
            category, issue = label_to_category_issue[pred_label]
            
            # Log the prediction
            logger.info(f"CLIP prediction: {issue} (confidence: {confidence:.2f})")

            # If CLIP says it's non-civic with reasonable confidence or
            # if all civic probabilities are weak compared to non-civic prompts, gate it
            if category == "non_civic" and confidence >= 0.45:
                return "non_civic", confidence

            # Otherwise continue with normalized civic mapping
            
            # Normalize the prediction to match our categories
            if "pothole" in issue.lower():
                normalized = "pothole"
            elif "streetlight" in issue.lower():
                normalized = "broken streetlight"
            elif "garbage" in issue.lower() or "bin" in issue.lower():
                normalized = "garbage overflow"
            elif "sewer" in issue.lower() or "sewage" in issue.lower():
                normalized = "sewage blockage"
            elif "toilet" in issue.lower():
                normalized = "damaged toilet"
            else:
                normalized = issue.lower()
            
            return normalized, confidence
            
        else:
            # Fallback to rule-based classification
            logger.warning("Using rule-based classification (CLIP not available)")
            
            img = image.convert("RGB")
            arr = numpy.array(img)

            # Heuristic 1: Skin-tone ratio (HSV-based)
            hsv = numpy.array(img.convert("HSV"))
            # PIL HSV is 0-255 for each channel
            H = hsv[:, :, 0].astype(numpy.int32)
            S = hsv[:, :, 1].astype(numpy.int32)
            V = hsv[:, :, 2].astype(numpy.int32)
            skin_mask = (
                (H >= 0) & (H <= 50) &
                (S >= int(0.23 * 255)) & (S <= int(0.68 * 255)) &
                (V >= int(0.35 * 255))
            )
            skin_ratio = float(skin_mask.mean()) if skin_mask.size else 0.0

            # Heuristic 2: Central skin concentration (focus on middle area)
            h, w = skin_mask.shape
            y0, y1 = int(h * 0.25), int(h * 0.75)
            x0, x1 = int(w * 0.25), int(w * 0.75)
            central_ratio = float(skin_mask[y0:y1, x0:x1].mean()) if h > 0 and w > 0 else 0.0

            if skin_ratio > 0.25 and central_ratio > 0.20:
                # Likely a selfie/portrait -> non-civic image
                conf = min(0.9, 0.5 + (skin_ratio + central_ratio) / 2)
                return "non_civic", conf

            # Fallback: very simple pixel-based heuristic for civic categories
            avg_color = arr.mean(axis=(0, 1))
            if avg_color[0] > 150:  # More red
                return "pothole", 0.6
            elif avg_color[2] > 150:  # More blue
                return "broken streetlight", 0.6
            else:
                return "garbage overflow", 0.5
                
    except Exception as e:
        logger.error(f"Error in image classification: {str(e)}")
        return "unclassified", 0.0
