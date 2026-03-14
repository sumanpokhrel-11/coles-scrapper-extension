import json
import re
from utils.ingredient_parser import parse_ingredient_tree

MACRO_MAP = {
    "Energy kJ Quantity Per 100g - Total - NIP": "energy_kj",
    "Protein Quantity Per 100g - Total - NIP": "protein_g",
    "Fat Total Quantity Per 100g - Total - NIP": "fat_total_g",
    "Fat Saturated Quantity Per 100g - Total - NIP": "fat_saturated_g",
    "Carbohydrate Quantity Per 100g - Total - NIP": "carbohydrates_g",
    "Sugars Quantity Per 100g - Total - NIP": "sugars_g",
    "Dietary Fibre Quantity Per 100g - Total - NIP": "fibre_g",
    "Sodium Quantity Per 100g - Total - NIP": "sodium_mg"
}

def clean_macro_value(raw_value: str) -> float:
    if not raw_value or raw_value.startswith('<'):
        return 0.0
    clean_str = re.sub(r'[^\d.]', '', raw_value)
    try:
        return float(clean_str)
    except ValueError:
        return 0.0

def parse_nutrition(raw_nip: str) -> dict:
    clean_macros = {}
    if not raw_nip: 
        return clean_macros
        
    try:
        nip = json.loads(raw_nip)
        for attr in nip.get("Attributes", []):
            ww_key = attr.get("Name")
            ww_value = attr.get("Value")
            
            if ww_key in MACRO_MAP and ww_value is not None:
                system_key = MACRO_MAP[ww_key]
                clean_macros[system_key] = clean_macro_value(ww_value)
                
        # Auto-calculate Calories (kcal) from kJ
        if "energy_kj" in clean_macros:
            clean_macros["calories_kcal"] = round(clean_macros["energy_kj"] / 4.184, 1)
            
        return clean_macros
    except Exception:
        return {}

def parse_atomic_allergens(raw_str: str) -> list:
    """Splits 'A, B, C' into ['a', 'b', 'c']."""
    if not raw_str: return []
    return [a.strip().lower() for a in raw_str.split(',') if a.strip()]

def parse_atomic_ingredients(raw_str: str) -> list:
    """Safely parses nested ingredient strings into atomic dictionaries."""
    if not raw_str: return []
    
    # 1. Split by commas, but IGNORE commas inside parentheses
    raw_items = []
    current_item = []
    depth = 0
    
    for char in raw_str:
        if char == '(': depth += 1
        elif char == ')': depth -= 1
        
        if char == ',' and depth == 0:
            raw_items.append(''.join(current_item).strip())
            current_item = []
        else:
            current_item.append(char)
            
    if current_item:
        raw_items.append(''.join(current_item).strip().rstrip('.'))
        
    # 2. Extract the Name, Percentage, and Sub-Ingredients
    atomic_ingredients = []
    for item in raw_items:
        if not item: continue
        
        name = item
        percentage = None
        sub_ingredients = None
        
        sub_match = re.search(r'^(.*?)\s*\((.*)\)$', item, re.DOTALL)
        if sub_match:
            name = sub_match.group(1).strip()
            sub_ingredients = sub_match.group(2).strip()
            
        pct_match = re.search(r'(.*?)\s*([\d.]+)\s*%$', name)
        if pct_match:
            name = pct_match.group(1).strip()
            try:
                percentage = float(pct_match.group(2))
            except ValueError:
                pass
                
        atomic_ingredients.append({
            "name": name,
            "percentage": percentage,
            "sub_ingredients": sub_ingredients,
            "raw": item
        })
        
    return atomic_ingredients

def normalize(data: dict):
    """The main entry point called by data_manager.py"""
    for bundle in (data.get("Products") or []):
        for p in bundle.get("Products", []):
            attrs = p.get("AdditionalAttributes", {}) or {}
            
            if p.get("IsMarketProduct", False) or not attrs.get("nutritionalinformation"):
                continue

            health_star = attrs.get("healthstarrating")
            health_star_float = float(health_star) if health_star and health_star.replace('.','',1).isdigit() else None

            return {
                "gtin": p.get("Barcode"),
                "name": p.get("DisplayName") or p.get("Name"),
                "brand": p.get("Brand"),
                "health_star_rating": health_star_float,
                "allergens": {
                    "contains": parse_atomic_allergens(attrs.get("allergencontains")),
                    "may_be_present": parse_atomic_allergens(attrs.get("allergenmaybepresent"))
                },
                "ingredients": parse_ingredient_tree(attrs.get("ingredients")),
                "additives": [],
                "macros_100g": parse_nutrition(attrs.get("nutritionalinformation")),
                "source": "Woolworths"
            }
    return None
