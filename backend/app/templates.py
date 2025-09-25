from datetime import datetime

# ------------------------
# Full mapping of issues
# ------------------------
mapping = {
    "Roads & Transport": {
        "Potholes": {
            "category": "Road Infrastructure Issue",
            "description": "Detected pothole on the road. May cause accidents and traffic delays.",
            "priority": "High"
        },
        "Damaged speed breakers": {
            "category": "Traffic Safety Issue",
            "description": "Speed breaker is damaged or uneven. Vehicles may lose balance, especially two-wheelers.",
            "priority": "Medium"
        },
        "Broken footpaths": {
            "category": "Pedestrian Safety Issue",
            "description": "Footpath is broken or uneven. Unsafe for pedestrians, especially elderly and children.",
            "priority": "Medium"
        },
        "Traffic signal malfunction": {
            "category": "Traffic Control System Failure",
            "description": "Traffic signal not working. Can cause traffic chaos and accidents.",
            "priority": "High"
        }
    },
    "Street Lighting & Electricity": {
        "Streetlight not working": {
            "category": "Public Lighting Issue",
            "description": "Streetlight is not functional. Area becomes dark and unsafe at night.",
            "priority": "High"
        },
        "Broken pole": {
            "category": "Electrical Infrastructure Damage",
            "description": "Electric pole is damaged. Risk of falling and electrical hazard.",
            "priority": "Critical"
        },
        "Exposed wires": {
            "category": "Electrical Safety Hazard",
            "description": "Exposed electrical wires found. High risk of electrocution, especially in rains.",
            "priority": "Critical"
        }
    },
    "Water Supply": {
        "Water leakage": {
            "category": "Water Infrastructure Issue",
            "description": "Water pipeline is leaking. Clean water is being wasted and road may get slippery.",
            "priority": "Medium"
        },
        "No water supply": {
            "category": "Water Service Disruption",
            "description": "No water supply in the area. Residents facing shortage of drinking water.",
            "priority": "High"
        }
    },
    "Sewage & Drainage": {
        "Blocked drain": {
            "category": "Drainage System Issue",
            "description": "Drain is blocked. Dirty water is stagnating and may cause mosquito breeding.",
            "priority": "Medium"
        },
        "Open manhole": {
            "category": "Public Safety Hazard",
            "description": "Manhole left open. Very dangerous for pedestrians, especially at night.",
            "priority": "Critical"
        },
        "Sewer overflow": {
            "category": "Sanitation Emergency",
            "description": "Sewage overflowing on road. Strong smell and unhygienic conditions.",
            "priority": "High"
        }
    },
    "Garbage & Sanitation": {
        "Overflowing garbage bin": {
            "category": "Waste Management Issue",
            "description": "Garbage bin overflowing. Stray animals spreading waste, foul smell in the area.",
            "priority": "Medium"
        }
    },
    "Parks & Public Spaces": {
        "Damaged benches": {
            "category": "Public Amenity Damage",
            "description": "Park benches are broken. Visitors cannot use them comfortably.",
            "priority": "Low"
        },
        "Garden maintenance": {
            "category": "Public Space Maintenance",
            "description": "Garden area not maintained. Overgrown grass and unclean surroundings.",
            "priority": "Low"
        }
    },
    "Public Health": {
        "Dead animal removal": {
            "category": "Public Health Emergency",
            "description": "Dead animal found in public area. Needs urgent removal to avoid smell and infection risk.",
            "priority": "Critical"
        }
    }
}

# Mapping AI predictions to template categories (canonical keys)
prediction_mapping = {
    "pothole": ("Roads & Transport", "Potholes"),
    "broken streetlight": ("Street Lighting & Electricity", "Streetlight not working"),
    "garbage overflow": ("Garbage & Sanitation", "Overflowing garbage bin"),
    "sewage blockage": ("Sewage & Drainage", "Sewer overflow"),
    "open manhole": ("Sewage & Drainage", "Open manhole"),
    # Fix: explicitly include these commonly mis-normalized classes
    "dead animal removal": ("Public Health", "Dead animal removal"),
    "exposed wires": ("Street Lighting & Electricity", "Exposed wires"),
}

# Lightweight synonym map for robust routing
SYNONYMS = {
    # Dead animal
    "dead animal": "dead animal removal",
    "dead dog": "dead animal removal",
    "dead cat": "dead animal removal",
    "animal carcass": "dead animal removal",
    "carcass": "dead animal removal",
    "remove dead animal": "dead animal removal",
    "dead rat": "dead animal removal",
    # Exposed wires
    "exposed wire": "exposed wires",
    "exposed wires": "exposed wires",
    "live wire": "exposed wires",
    "dangling wire": "exposed wires",
    "loose wire": "exposed wires",
    "exposed cable": "exposed wires",
    "exposed cables": "exposed wires",
    "wire hanging": "exposed wires",
}

try:
    from rapidfuzz.fuzz import token_set_ratio as _fuzz
except Exception:
    _fuzz = None

def resolve_prediction(predicted_issue: str):
    """Resolve a predicted string to (issue_type, subcategory) using
    - exact prediction_mapping
    - synonyms
    - simple keyword rules
    - optional fuzzy match against known subcategories
    Returns tuple or None if not resolved.
    """
    if not predicted_issue:
        return None
    s = (predicted_issue or "").strip().lower()
    # direct mapping
    if s in prediction_mapping:
        return prediction_mapping[s]
    # synonyms
    if s in SYNONYMS and SYNONYMS[s] in prediction_mapping:
        return prediction_mapping[SYNONYMS[s]]
    # keyword rules
    if ("dead" in s and ("animal" in s or "dog" in s or "cat" in s or "carcass" in s)):
        return prediction_mapping["dead animal removal"]
    if (("wire" in s or "cable" in s) and ("exposed" in s or "live" in s or "dangling" in s or "open" in s or "loose" in s)):
        return prediction_mapping["exposed wires"]
    # fuzzy against all subcategories
    if _fuzz:
        best = None
        best_score = -1
        for issue_type, issues in mapping.items():
            for subcat in issues.keys():
                sub_l = subcat.lower()
                try:
                    score = _fuzz(s, sub_l)
                except Exception:
                    score = 0
                if score > best_score:
                    best_score = score
                    best = (issue_type, subcat)
        if best and best_score >= 84:
            return best
    return None

def create_issue_report(predicted_issue, user_location=None):
    """
    Creates a formatted issue report with category, description, and location
    """
    resolved = resolve_prediction(predicted_issue)
    if resolved:
        issue_type, subcategory = resolved
        if issue_type in mapping and subcategory in mapping[issue_type]:
            issue_data = mapping[issue_type][subcategory]
            report = {
                "issue_category": issue_data["category"],
                "detailed_description": issue_data["description"],
                "priority_level": issue_data["priority"],
                "reported_location": {
                    "latitude": user_location.get("lat") if user_location else None,
                    "longitude": user_location.get("lng") if user_location else None,
                    "address": user_location.get("address") if user_location else "Location not available",
                    "city": user_location.get("city") if user_location else "Unknown",
                    "area": user_location.get("area") if user_location else "Unknown"
                },
                "timestamp": datetime.now().isoformat(),
                "status": "Reported"
            }
            return report

    # Default response
    return {
    "issue_category": f"Unclassified Issue: {predicted_issue}",
        "detailed_description": f"AI detected: {predicted_issue}. Please verify and assign to appropriate department.",
        "priority_level": "Medium",
        "reported_location": {
            "latitude": user_location.get("lat") if user_location else None,
            "longitude": user_location.get("lng") if user_location else None,
            "address": user_location.get("address") if user_location else "Location not available",
            "city": user_location.get("city") if user_location else "Unknown",
            "area": user_location.get("area") if user_location else "Unknown"
        },
        "timestamp": datetime.now().isoformat(),
        "status": "Reported"
    }
