from core import storage_manager
from providers.woolworths import client as ww_client
from providers.woolworths import formatter as ww_formatter

def _generate_barcode_variations(barcode):
    """Generates common retail database permutations of a barcode."""
    variations = [barcode]
    if barcode.startswith('0'):
        variations.append(barcode.lstrip('0'))
    if len(barcode) == 12:
        variations.append('0' + barcode)
    return list(dict.fromkeys(variations))

def get_product(scanned_gtin):
    """The main orchestrator: Check L1 -> Fetch Raw -> Save L0 -> Normalize -> Save L1"""
    
    # 1. Check Level 1 Cache (Normalized Data)
    cached_data = storage_manager.get_normalized(scanned_gtin)
    if cached_data:
        print(f"  [+] L1 Cache Hit for: {scanned_gtin}")
        return cached_data

    print(f"  [*] Cache Miss. Initiating waterfall for: {scanned_gtin}")
    variations = _generate_barcode_variations(scanned_gtin)

    # 2. Waterfall Tier 1: Woolworths
    for candidate in variations:
        print(f"    -> Testing Woolworths with candidate: {candidate}")
        
        # Extract (Fetch Raw)
        raw_data = ww_client.fetch_raw(candidate)
        if not raw_data:
            continue
            
        # Transform (Normalize and run the "Roof Rack" filter)
        normalized_data = ww_formatter.normalize(raw_data)
        if not normalized_data:
            continue 

        print(f"  [+] Valid data found! Saving L0 and L1 caches for: {candidate}")
        
        # Load L0 (Save the raw evidence)
        storage_manager.save_raw(candidate, raw_data, "woolworths")
        
        # Load L1 (Save the normalized view and symlink the aliases)
        storage_manager.save_normalized(candidate, normalized_data, variations)
        
        return normalized_data

    # 3. Waterfall Tier 2: BarcodeLookup (Future)
    # ...

    return None
