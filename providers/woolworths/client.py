from curl_cffi import requests

IMPERSONATE = "chrome120"
BASE_URL = "https://www.woolworths.com.au"
SEARCH_URL = f"{BASE_URL}/apis/ui/Search/products"
HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-AU,en;q=0.9",
    "referer": "https://www.woolworths.com.au/",
    "origin": "https://www.woolworths.com.au",
    "x-requested-with": "XMLHttpRequest",
}

def fetch_raw(gtin):
    session = requests.Session(impersonate=IMPERSONATE)
    session.headers.update(HEADERS)
    session.get(BASE_URL, timeout=10)  # Seed cookies

    params = {"searchTerm": gtin, "pageNumber": 1, "pageSize": 1}
    resp = session.get(SEARCH_URL, params=params, timeout=10)
    
    if resp.status_code == 200:
        return resp.json()
    return None
