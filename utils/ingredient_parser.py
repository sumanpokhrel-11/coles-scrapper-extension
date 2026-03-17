import re

def _sanitize_ocr(raw_str: str) -> str:
    # Fixes "Eu,calyptus" -> "Eucalyptus" and "Dextr,in" -> "Dextrin"
    return re.sub(r'(?<=[a-zA-Z]),(?=[a-z])', '', raw_str)

def _split_at_depth_zero(raw_str: str, delimiters: tuple = (',', ':')) -> list:
    items, current_item, depth = [], [], 0
    for char in raw_str:
        if char == '(': depth += 1
        elif char == ')': depth -= 1
        
        # Now splits on any character in the delimiters tuple
        if char in delimiters and depth == 0:
            items.append(''.join(current_item).strip())
            current_item = []
        else:
            current_item.append(char)
            
    if current_item:
        items.append(''.join(current_item).strip().rstrip('.'))
        
    # Safely filter out empty strings in case of trailing delimiters or "::"
    return [item for item in items if item]

def _parse_single_ingredient(raw_item: str) -> dict:
    if not raw_item: return None
    
    name, percentage, sub_ingredients_raw = raw_item, None, None
    
    match = re.search(r'^(.*?)\s*\((.*)\)$', raw_item, re.DOTALL)
    if match:
        name, sub_ingredients_raw = match.group(1).strip(), match.group(2).strip()
        
    pct_match = re.search(r'(.*?)\s*([\d.]+)\s*%$', name)
    if pct_match:
        name = pct_match.group(1).strip()
        try: percentage = float(pct_match.group(2))
        except ValueError: pass
            
    return {
        "name": name,
        "percentage": percentage,
        "sub_ingredients": parse_ingredient_tree(sub_ingredients_raw) if sub_ingredients_raw else None,
        "raw": raw_item
    }

def parse_ingredient_tree(raw_str: str) -> list:
    if not raw_str: return []
    cleaned_str = _sanitize_ocr(raw_str)
    return [parsed for item in _split_at_depth_zero(cleaned_str) if (parsed := _parse_single_ingredient(item))]
