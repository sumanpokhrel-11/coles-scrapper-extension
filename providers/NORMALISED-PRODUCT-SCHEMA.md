# Trigzi Normalized Product Schema

This document defines the standard JSON structure for all food products stored in the Level 1 (L1) Cache and consumed by the iOS client.

### Core Product Metadata

| Field | Type | Nullable | Description |
| --- | --- | --- | --- |
| `gtin` | `String` | No | The Global Trade Item Number (Barcode). |
| `name` | `String` | No | The full display name of the product. |
| `brand` | `String` | Yes | The brand or manufacturer name. |
| `source` | `String` | No | The provider of this data (e.g., `"Woolworths"`, `"Coles"`, `"LLM_Worker"`). |

### Physical Attributes

| Field | Type | Nullable | Description |
| --- | --- | --- | --- |
| `package_size_g` | `Float` | Yes | The total net weight of the package in grams. |
| `serving_size_g` | `Float` | Yes | The suggested serving size in grams. |
| `health_star_rating` | `Float` | Yes | The AU/NZ Health Star Rating (0.5 to 5.0). |

### Dietary & Health (The Defensive Shield)

| Field | Type | Nullable | Description |
| --- | --- | --- | --- |
| `dietary_claims` | `Array[String]` | No | Aggregated explicit "Free From" and lifestyle claims (e.g., `["Gluten Free", "Vegan"]`). Empty array if none. |
| `allergens` | `Object` | No | Contains `contains` and `may_be_present` arrays of standardized lowercase strings (e.g., `["milk", "soy"]`). |
| `additives` | `Array[String]` | No | Extracted E-numbers or known additives. Empty array if none. |

### Ingredients (Recursive Tree)

The `ingredients` field is an `Array[IngredientObject]`. To handle complex nested labels (e.g., "Chocolate (Sugar, Cocoa...)"), the schema allows ingredients to contain their own sub-ingredients.

**IngredientObject:**
| Field | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `name` | `String` | No | The cleaned name of the ingredient. |
| `percentage` | `Float` | Yes | The declared percentage (e.g., `10.5` for "10.5%"). |
| `sub_ingredients` | `Array[IngredientObject]` | Yes | A recursive list of nested ingredients. |
| `raw` | `String` | No | The original, unparsed string for this specific node. |

### Nutritional Macros

Both `macros_100g` and `macros_serve` share the same structure. Values are `Float`. If a nutrient is unlisted, the key may be omitted or explicitly set to `0.0`.

| Field | Type | Description |
| --- | --- | --- |
| `energy_kj` | `Float` | Total energy in kilojoules. |
| `calories_kcal` | `Float` | Auto-calculated (kJ / 4.184). |
| `protein_g` | `Float` | Protein in grams. |
| `fat_total_g` | `Float` | Total fat in grams. |
| `fat_saturated_g` | `Float` | Saturated fat in grams. |
| `carbohydrates_g` | `Float` | Total carbohydrates in grams. |
| `sugars_g` | `Float` | Total sugars in grams. |
| `fibre_g` | `Float` | Dietary fibre in grams. |
| `sodium_mg` | `Float` | Sodium in milligrams. |

---

### Example Payload (Fisherman's Friend)

```json
{
  "gtin": "50357161",
  "name": "Fisherman's Friend Mints Extra Strong 25g",
  "brand": "Fisherman's Friend",
  "package_size_g": 25.0,
  "serving_size_g": 1.25,
  "health_star_rating": null,
  "dietary_claims": [
    "Dairy Free",
    "Egg Free",
    "Fish Free",
    "Gluten Free",
    "Kosher",
    "Lactose Free",
    "Low Fat",
    "Low Salt",
    "Soy Free",
    "Vegan",
    "Vegetarian",
    "Wheat Free"
  ],
  "allergens": {
    "contains": [],
    "may_be_present": []
  },
  "ingredients": [
    {
      "name": "Sugar",
      "percentage": null,
      "sub_ingredients": null,
      "raw": "Sugar"
    },
    {
      "name": "Flavourings",
      "percentage": null,
      "sub_ingredients": null,
      "raw": "Flavourings"
    },
    {
      "name": "Liquorice Extract",
      "percentage": null,
      "sub_ingredients": null,
      "raw": "Liquorice Extract"
    },
    {
      "name": "Menthol",
      "percentage": null,
      "sub_ingredients": null,
      "raw": "Menthol"
    },
    {
      "name": "Eucalyptus Oil",
      "percentage": null,
      "sub_ingredients": null,
      "raw": "Eucalyptus Oil"
    }
  ],
  "additives": [],
  "macros_100g": {
    "carbohydrates_g": 94.9,
    "fibre_g": 0.5,
    "energy_kj": 1620.0,
    "fat_saturated_g": 1.0,
    "fat_total_g": 1.0,
    "protein_g": 1.0,
    "sodium_mg": 5.0,
    "sugars_g": 88.8,
    "calories_kcal": 387.2
  },
  "macros_serve": {
    "carbohydrates_g": 1.2,
    "fibre_g": 0.1,
    "energy_kj": 20.0,
    "fat_saturated_g": 0.1,
    "fat_total_g": 0.1,
    "protein_g": 0.1,
    "sodium_mg": 1.0,
    "sugars_g": 1.1,
    "calories_kcal": 4.8
  },
  "source": "Woolworths"
}

```

