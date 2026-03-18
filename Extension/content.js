/**
 * Coles Product Scraper - Content Script
 * Runs on https://www.coles.com.au/product/* pages
 * Extracts __NEXT_DATA__ and sends product data to background service worker.
 */

const IMAGE_CDN = 'https://cdn.productimages.coles.com.au/productimages';
const NO_DATA_TIMEOUT_MS = 30000;

function extractProduct() {
  const el = document.querySelector('script#__NEXT_DATA__');
  if (!el) return null;

  let json;
  try {
    json = JSON.parse(el.textContent);
  } catch (e) {
    return null;
  }

  const p = json?.props?.pageProps?.product;
  if (!p) return null;

  // Price fields
  const pricing = p.pricing || {};
  const priceNow = pricing.now ?? null;
  const priceWas = pricing.was ?? null;
  const priceComparable = pricing.comparable ?? null;

  // Category
  const heirs = p.onlineHeirs || [];
  const category = heirs[0]?.subCategory ?? null;
  const subCategory = heirs[0]?.aisle ?? null;

  // Additional info
  const additionalInfo = p.additionalInfo || [];
  const ingredientsEntry = additionalInfo.find(
    (a) => (a.title || '').toLowerCase().includes('ingredient')
  );
  const allergensEntry = additionalInfo.find(
    (a) => (a.title || '').toLowerCase().includes('allergen')
  );
  const ingredients = ingredientsEntry?.description ?? null;
  const allergens = allergensEntry?.description ?? null;

  // Country of origin
  const coo = p.countryOfOrigin || {};
  const countryOfOrigin = coo.statement || coo.country || null;

  // Image URL
  let imageUrl = null;
  if (p.images && p.images.length > 0 && p.images[0].uri) {
    imageUrl = `${IMAGE_CDN}${p.images[0].uri}`;
  } else if (p.id) {
    const idStr = String(p.id);
    imageUrl = `${IMAGE_CDN}/${idStr.slice(-1)}/${p.id}.jpg`;
  }

  return {
    url: location.href,
    coles_id: p.id ?? null,
    gtin: p.gtin ?? null,
    name: p.name ?? null,
    brand: p.brand ?? null,
    size: p.size ?? null,
    price_now: priceNow,
    price_was: priceWas,
    price_comparable: priceComparable,
    category,
    sub_category: subCategory,
    description: p.description ?? null,
    long_description: p.longDescription ?? null,
    ingredients,
    allergens,
    lifestyle_tags: JSON.stringify(p.lifestyle || []),
    country_of_origin: countryOfOrigin,
    nutrition_json: JSON.stringify(p.nutrition || {}),
    image_url: imageUrl,
    scraped_at: new Date().toISOString(),
  };
}

function sendProduct(product) {
  chrome.runtime.sendMessage({ type: 'PRODUCT_DATA', data: product });
}

function sendNoData() {
  chrome.runtime.sendMessage({ type: 'PAGE_NO_DATA', url: location.href });
}

// Attempt immediate extraction
const product = extractProduct();
if (product) {
  sendProduct(product);
} else {
  // Watch for __NEXT_DATA__ to appear (e.g. after a challenge redirect)
  let sent = false;
  let timeoutId = null;

  const observer = new MutationObserver(() => {
    if (sent) return;
    const found = extractProduct();
    if (found) {
      sent = true;
      clearTimeout(timeoutId);
      observer.disconnect();
      sendProduct(found);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Fallback: if data never appears within 30 seconds, report failure
  timeoutId = setTimeout(() => {
    if (!sent) {
      sent = true;
      observer.disconnect();
      sendNoData();
    }
  }, NO_DATA_TIMEOUT_MS);
}
