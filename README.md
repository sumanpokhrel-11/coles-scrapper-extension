# Edge-to-Cloud Product API

A stateless, N-Tier Flask backend designed to ingest raw retailer barcode data, normalize it into a strict domain model, and serve it to a mobile iOS client.

## Architecture Overview

This system uses an Extract, Load, Transform (ELT) pipeline to ensure the client application is completely decoupled from external retailer APIs (like Woolworths or Coles).

* **L0 Cache (Raw):** Stores the unmodified vendor JSON dump for auditing and future-proofing.
* **L1 Cache (Normalized):** A strictly typed, mathematically-ready JSON schema served to the mobile client.
* **Symlink Aliasing:** Automatically generates zero-byte symlinks for UPC-A / EAN-13 barcode variations (e.g., stripping or padding leading zeros) to guarantee O(1) cache hits on subsequent scans regardless of how the iOS camera interprets the barcode.

## Directory Taxonomy

```text
backend/
├── app.py                     # API Router and HTTP validation
├── core/
│   ├── data_manager.py        # ELT Orchestrator (Fetch -> Save L0 -> Normalize -> Save L1)
│   └── storage_manager.py     # Centralized I/O and sharded directory manager
├── providers/
│   ├── woolworths/            # Stateless provider tier
│   │   ├── client.py          # HTTP requests to vendor API
│   │   └── formatter.py       # Maps vendor JSON to the strict L1 schema
│   └── barcodelookup/         # (Future fallback provider)
├── utils/
│   └── ingredient_parser.py   # Recursive AST parser for nested ingredient brackets
└── data/                      # Sharded local cache (chown to Gunicorn user)
    ├── raw/                   # L0 Cache (e.g., raw/woolworths/451/9319133333451.json)
    └── normalized/            # L1 Cache (e.g., normalized/451/9319133333451.json)

```

## The L1 Domain Model (`normalized_form`)

The API guarantees this exact structure for all successful queries, regardless of the underlying data provider. Macros are converted to pure floats, and ingredients form a recursive Abstract Syntax Tree (AST).

```json
{
  "status": "success",
  "gtin": "9319133333451",
  "product_data": {
    "name": "Carman's Muesli Toasted Super Berry...",
    "brand": "Carman's",
    "health_star_rating": 4.0,
    "allergens": {
      "contains": ["sesame", "gluten", "almond", "pecan"],
      "may_be_present": ["milk", "tree nuts", "peanuts", "soy", "lupin", "wheat"]
    },
    "ingredients": [
      {
        "name": "Fruit",
        "percentage": 10.0,
        "sub_ingredients": [
          { "name": "Blueberries", "percentage": 1.0, "sub_ingredients": null, "raw": "Blueberries" }
        ],
        "raw": "Fruit 10% (Blueberries 1%)"
      }
    ],
    "macros_100g": {
      "calories_kcal": 449.3,
      "energy_kj": 1880.0,
      "protein_g": 10.6,
      "fat_total_g": 20.5,
      "carbohydrates_g": 51.1,
      "sugars_g": 12.6,
      "sodium_mg": 15.0
    },
    "source": "Woolworths"
  },
  "conversation": "Looks like you scanned Carman's Muesli..."
}

```

## Setup & Deployment

1. **Install Dependencies:**
```bash
pip install flask curl_cffi

```


2. **Initialize Data Directories:**
The application requires a `data/` directory at the project root. If running via Gunicorn or Systemd, the background user must have explicit write permissions.
```bash
mkdir -p data/raw data/normalized
sudo chown -R your_web_user:your_web_group data/
sudo chmod -R 755 data/

```


3. **Run Server:**
```bash
gunicorn -w 4 -b 127.0.0.1:5000 app:app

```



## API Usage

**Endpoint:** `GET /api/v1/product/<gtin>`

* **200 OK:** Returns the `normalized_form` JSON.
* **400 Bad Request:** If the GTIN fails numeric or length validation (8-14 digits).
* **404 Not Found:** If the product cannot be located in the local cache or upstream providers.

*** Would you like me to add anything specific about the iOS SwiftData requirements to the README, or are we ready to jump back into Xcode?
