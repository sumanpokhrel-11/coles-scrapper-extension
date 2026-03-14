from flask import Flask, jsonify
from core import data_manager
import time

app = Flask(__name__)

def generate_nutrition_conversation(product_data):
    name = product_data.get('name', 'this product')
    macros = product_data.get('macros_100g', {})
    
    # Grab the clean floats
    protein = macros.get('protein_g')
    calories = macros.get('calories_kcal')
    
    # Format them for speech
    protein_str = f"{protein}g of" if protein is not None else "an unknown amount of"
    cal_str = f"{calories} calories" if calories is not None else "unknown"
    
    return f"Looks like you scanned {name}. It packs {protein_str} protein per 100g. Total energy is {cal_str}."

MIN_GTIN_LEN = 8
MAX_GTIN_LEN = 14

@app.route('/api/v1/product/<gtin>', methods=['GET'])
def get_product(gtin):
    print(f"[{time.strftime('%H:%M:%S')}] Received scan for GTIN: {gtin}")
    
    if not gtin.isdigit() or not (MIN_GTIN_LEN <= len(gtin) <= MAX_GTIN_LEN):
        print(f"  [!] Rejected: Invalid format.")
        return jsonify({
            "status": "error",
            "message": f"Invalid barcode. Must be between {MIN_GTIN_LEN} and {MAX_GTIN_LEN} numeric digits."
        }), 400

    # Hand off to the Orchestrator
    product_data = data_manager.get_product(gtin)
    
    if not product_data:
        return jsonify({
            "status": "error",
            "message": "Product not found in cache or upstream databases."
        }), 404

    conversation = generate_nutrition_conversation(product_data)

    return jsonify({
        "status": "success",
        "gtin": gtin,
        "product_data": product_data,
        "conversation": conversation
    }), 200

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)
