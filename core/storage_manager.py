import os
import json

# Automatically find the absolute path to the backend root
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Define exact absolute paths
DATA_ROOT = os.path.join(BASE_DIR, "data")
RAW_DIR = os.path.join(DATA_ROOT, "raw")
L1_CACHE_DIR = os.path.join(DATA_ROOT, "normalized")

def _get_shard_path(base_dir, gtin):
    """Uses the last 3 characters of the barcode for even directory distribution."""
    padded = str(gtin).zfill(3)
    folder = padded[-3:]
    return os.path.join(base_dir, folder)

def save_raw(gtin, raw_data, provider_name):
    """Saves the exact vendor payload to data/raw/<provider>/<shard>/<gtin>.json"""
    provider_dir = os.path.join(RAW_DIR, provider_name.lower())
    shard_dir = _get_shard_path(provider_dir, gtin)
    
    os.makedirs(shard_dir, exist_ok=True)
    file_path = os.path.join(shard_dir, f"{gtin}.json")
    
    with open(file_path, 'w') as f:
        json.dump(raw_data, f, indent=2)

def get_raw(gtin):
    """Checks all raw provider directories for a cached payload."""
    for provider in ["woolworths", "coles", "barcodelookup"]:
        provider_dir = os.path.join(RAW_DIR, provider)
        shard_dir = _get_shard_path(provider_dir, gtin)
        file_path = os.path.join(shard_dir, f"{gtin}.json")
        
        if os.path.exists(file_path):
            with open(file_path, 'r') as f:
                return json.load(f), provider
                
    return None, None

def save_normalized(true_gtin, normalized_data, aliases=None):
    """Saves the L1 cache and sets up relative symlinks for any barcode aliases."""
    if aliases is None:
        aliases = []
        
    shard_dir = _get_shard_path(L1_CACHE_DIR, true_gtin)
    os.makedirs(shard_dir, exist_ok=True)
    
    true_path = os.path.join(shard_dir, f"{true_gtin}.json")
    
    # 1. Save the true Normalized Data
    with open(true_path, 'w') as f:
        json.dump(normalized_data, f, indent=2)
        
    # 2. Handle ALL Aliases (Scanned Code & Successful Trimmed Candidates)
    alias_set = set(aliases)
    alias_set.discard(true_gtin)
    
    for alias in alias_set:
        alias_shard_dir = _get_shard_path(L1_CACHE_DIR, alias)
        os.makedirs(alias_shard_dir, exist_ok=True)
        alias_path = os.path.join(alias_shard_dir, f"{alias}.json")
        
        if not os.path.exists(alias_path):
            # Create a relative symlink back to the true_path
            rel_target = os.path.relpath(true_path, alias_shard_dir)
            os.symlink(rel_target, alias_path)

def get_normalized(gtin):
    """Retrieves the L1 cache payload (transparently follows symlinks)."""
    shard_dir = _get_shard_path(L1_CACHE_DIR, gtin)
    file_path = os.path.join(shard_dir, f"{gtin}.json")
    
    if os.path.exists(file_path):
        with open(file_path, 'r') as f:
            return json.load(f)
            
    return None
