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
            
            # Simple pixel-based analysis
            img_array = numpy.array(image)
            avg_color = img_array.mean(axis=(0, 1))
            
            if avg_color[0] > 150:  # More red
                return "pothole", 0.6
            elif avg_color[2] > 150:  # More blue
                return "broken streetlight", 0.6
            else:
                return "garbage overflow", 0.5
                
    except Exception as e:
        logger.error(f"Error in image classification: {str(e)}")
        return "unclassified", 0.0
