#!/usr/bin/env python3

import json
import re

def _split_at_depth_zero(raw_str: str, delimiter: str = ',') -> list:
    """Splits a string by a delimiter, but ignores delimiters inside parentheses."""
    items = []
    current_item = []
    depth = 0
    
    for char in raw_str:
        if char == '(':
            depth += 1
            current_item.append(char)
        elif char == ')':
            depth -= 1
            current_item.append(char)
        elif char == delimiter and depth == 0:
            items.append(''.join(current_item).strip())
            current_item = []
        else:
            current_item.append(char)
            
    if current_item:
        # Catch the final item and strip any trailing full stops
        items.append(''.join(current_item).strip().rstrip('.'))
        
    return items

def _parse_single_ingredient(raw_item: str) -> dict:
    """Extracts name, percentage, and triggers recursion for sub-ingredients."""
    if not raw_item:
        return None
        
    name = raw_item
    percentage = None
    sub_ingredients_raw = None
    
    # 1. Separate the parent item from its children (inside parentheses)
    # Using regex to grab everything up to the first open parenthesis, and everything inside
    match = re.search(r'^(.*?)\s*\((.*)\)$', raw_item, re.DOTALL)
    if match:
        name = match.group(1).strip()
        sub_ingredients_raw = match.group(2).strip()
        
    # 2. Extract percentage from the parent name (e.g., "Fruit 10%")
    pct_match = re.search(r'(.*?)\s*([\d.]+)\s*%$', name)
    if pct_match:
        name = pct_match.group(1).strip()
        try:
            percentage = float(pct_match.group(2))
        except ValueError:
            pass
            
    # 3. Recursion: If this ingredient has sub-ingredients, parse them as a new list
    sub_ingredients = None
    if sub_ingredients_raw:
        sub_ingredients = parse_ingredient_tree(sub_ingredients_raw)
        
    return {
        "name": name,
        "percentage": percentage,
        "sub_ingredients": sub_ingredients,
        "raw": raw_item
    }

def parse_ingredient_tree(raw_str: str) -> list:
    """The main entry point. Converts a raw string into a nested atomic list."""
    if not raw_str: return []
    
    # 1. Split the string into top-level chunks
    raw_items = _split_at_depth_zero(raw_str)
    
    # 2. Parse each chunk (which may trigger deep recursion)
    parsed_items = []
    for item in raw_items:
        if item:
            parsed = _parse_single_ingredient(item)
            if parsed:
                parsed_items.append(parsed)
                
    return parsed_items

# ==========================================
# TEST RUNNER
# ==========================================
if __name__ == "__main__":
    test_string = "Whole Grain Oats, Fruit 10% (Berries Cranberries 2% (Cranberries, Sugar, Sunflower Oil), Goji Berries, Blueberries 1% (Blueberries, Sugar, Sunflower Oil), Currants, Coconut), Nuts 9% (Almonds, Pecans), Golden Syrup, Seeds 8% (Sunflower, Sesame, Pepitas), Sunflower Oil, Cinnamon, Vitamin (Vitamin E)."
    
    print("Parsing deeply nested ingredient string...")
    atomic_tree = parse_ingredient_tree(test_string)
    
    print("\nResult:")
    print(json.dumps(atomic_tree, indent=2))
