import json
import re
from utils.ingredient_parser import parse_ingredient_tree

MACRO_MAP_100G = {
    "Energy kJ Quantity Per 100g - Total - NIP": "energy_kj",
    "Protein Quantity Per 100g - Total - NIP": "protein_g",
    "Fat Total Quantity Per 100g - Total - NIP": "fat_total_g",
    "Fat Saturated Quantity Per 100g - Total - NIP": "fat_saturated_g",
    "Carbohydrate Quantity Per 100g - Total - NIP": "carbohydrates_g",
    "Sugars Quantity Per 100g - Total - NIP": "sugars_g",
    "Dietary Fibre Quantity Per 100g - Total - NIP": "fibre_g",
    "Sodium Quantity Per 100g - Total - NIP": "sodium_mg"
}

MACRO_MAP_SERVE = {
    "Energy kJ Quantity Per Serve - Total - NIP": "energy_kj",
    "Protein Quantity Per Serve - Total - NIP": "protein_g",
    "Fat Total Quantity Per Serve - Total - NIP": "fat_total_g",
    "Fat Saturated Quantity Per Serve - Total - NIP": "fat_saturated_g",
    "Carbohydrate Quantity Per Serve - Total - NIP": "carbohydrates_g",
    "Sugars Quantity Per Serve - Total - NIP": "sugars_g",
    "Dietary Fibre Quantity Per Serve - Total - NIP": "fibre_g",
    "Sodium Quantity Per Serve - Total - NIP": "sodium_mg"
}

def clean_macro_value(raw_value: str) -> float:
    if not raw_value or raw_value.startswith('<'):
        return 0.0
    clean_str = re.sub(r'[^\d.]', '', raw_value)
    try:
        return float(clean_str)
    except ValueError:
        return 0.0

def parse_nutrition(raw_nip: str) -> tuple:
    """Returns (macros_100g, macros_serve, serving_size_g)"""
    macros_100g = {}
    macros_serve = {}
    serving_size_g = None
    
    if not raw_nip: 
        return macros_100g, macros_serve, serving_size_g
        
    try:
        nip = json.loads(raw_nip)
        for attr in nip.get("Attributes", []):
            ww_key = attr.get("Name")
            ww_value = attr.get("Value")
            
            if ww_key == "Serving Size - Total - NIP" and ww_value:
                serving_size_g = clean_macro_value(ww_value)
            
            if ww_key in MACRO_MAP_100G and ww_value is not None:
                macros_100g[MACRO_MAP_100G[ww_key]] = clean_macro_value(ww_value)
                
            if ww_key in MACRO_MAP_SERVE and ww_value is not None:
                macros_serve[MACRO_MAP_SERVE[ww_key]] = clean_macro_value(ww_value)
                
        # Auto-calculate Calories (kcal) from kJ for both metrics
        if "energy_kj" in macros_100g:
            macros_100g["calories_kcal"] = round(macros_100g["energy_kj"] / 4.184, 1)
        if "energy_kj" in macros_serve:
            macros_serve["calories_kcal"] = round(macros_serve["energy_kj"] / 4.184, 1)
            
    except Exception:
        pass
        
    return macros_100g, macros_serve, serving_size_g

def parse_atomic_allergens(raw_str: str) -> list:
    """Splits 'A, B, C' into ['a', 'b', 'c']."""
    if not raw_str: return []
    return [a.strip().lower() for a in raw_str.split(',') if a.strip()]

def parse_dietary_claims(attrs: dict) -> list:
    """Aggregates lifestyle and allergy claims into a single deduped list."""
    combined_str = f"{attrs.get('allergystatement', '')},{attrs.get('lifestyleanddietarystatement', '')},{attrs.get('lifestyleclaim', '')},{attrs.get('wool_dietaryclaim', '')}"
    claims = [c.strip().title() for c in combined_str.split(',') if c.strip() and c.strip().lower() != 'none']
    return sorted(list(set(claims)))

def normalize(data: dict):
    """The main entry point called by data_manager.py"""
    for bundle in (data.get("Products") or []):
        for p in bundle.get("Products", []):
            attrs = p.get("AdditionalAttributes", {}) or {}
            
            if p.get("IsMarketProduct", False) or not attrs.get("nutritionalinformation"):
                continue

            # Extract Health Star Rating
            health_star = attrs.get("healthstarrating")
            health_star_float = float(health_star) if health_star and health_star.replace('.','',1).isdigit() else None

            # Extract Package Size (e.g. "25g" -> 25.0)
            package_size_raw = p.get("PackageSize")
            package_size_g = clean_macro_value(package_size_raw) if package_size_raw else None

            # Process Nutritional Data
            macros_100g, macros_serve, serving_size_g = parse_nutrition(attrs.get("nutritionalinformation"))

            return {
                "gtin": p.get("Barcode"),
                "name": p.get("DisplayName") or p.get("Name"),
                "brand": p.get("Brand"),
                "package_size_g": package_size_g,
                "serving_size_g": serving_size_g,
                "health_star_rating": health_star_float,
                "dietary_claims": parse_dietary_claims(attrs),
                "allergens": {
                    "contains": parse_atomic_allergens(attrs.get("allergencontains")),
                    "may_be_present": parse_atomic_allergens(attrs.get("allergenmaybepresent"))
                },
                "ingredients": parse_ingredient_tree(attrs.get("ingredients")),
                "additives": [],
                "macros_100g": macros_100g,
                "macros_serve": macros_serve,
                "source": "Woolworths"
            }
    return None
