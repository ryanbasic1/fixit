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

# Mapping AI predictions to template categories
prediction_mapping = {
    "pothole": ("Roads & Transport", "Potholes"),
    "broken streetlight": ("Street Lighting & Electricity", "Streetlight not working"),
    "garbage overflow": ("Garbage & Sanitation", "Overflowing garbage bin"),
    "damaged toilet": ("Public Health", "Dead animal removal"),
    "sewage blockage": ("Sewage & Drainage", "Sewer overflow"),
    "open manhole": ("Sewage & Drainage", "Open manhole")
}

def create_issue_report(predicted_issue, user_location=None):
    """
    Creates a formatted issue report with category, description, and location
    """
    if predicted_issue in prediction_mapping:
        issue_type, subcategory = prediction_mapping[predicted_issue]
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
