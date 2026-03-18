'use strict';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE        = 'https://www.coles.com.au';
const CONCURRENCY = 4;   // parallel category workers
const PAGE_DELAY  = 700; // ms between page fetches (per worker)

// Categories to skip — promotional pages that don't have stable product listings
const SKIP_SLUGS = new Set([
  'specials', 'down-down', 'easter', 'bonus-credit-products',
  'big-pack-value', 'deliver-more-range', 'new',
]);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isRunning      = false;
let allUrls        = new Set();
let knownIds       = new Set();
let categoryRows   = {};
let categoriesList = [];
let buildId        = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractId(url) {
  const m = (url || '').match(/-(\d+)(?:\/.*)?$/);
  return m ? m[1] : null;
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-AU,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

// Try multiple approaches to fetch a paginated browse page.
// Coles renders page 1 server-side; pages 2+ are loaded by React via an internal API.
async function fetchPageData(slugParts, pageNumber) {
  const slugPath = slugParts.join('/');

  // ── Approach 1: Coles internal catalog API (what React calls client-side) ──
  try {
    const url = `${BASE}/api/2.0/page/categories/${slugPath}?pageNumber=${pageNumber}&pageSize=48&sortType=&inStoreLocation=&filters=`;
    const r = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (r.ok) {
      const j = await r.json();
      const sr = j?.searchResults;
      if (sr?.results?.length) {
        console.log(`[Coles API p${pageNumber}] ${slugPath} → first id: ${sr.results[0]?.id}`);
        return { searchResults: sr };
      }
      console.warn(`[Coles API p${pageNumber}] ${slugPath} → ok but no results`, j);
    } else {
      console.warn(`[Coles API p${pageNumber}] HTTP ${r.status} for ${url}`);
    }
  } catch (e) {
    console.warn('[Coles API] fetch error:', e.message);
  }

  // ── Approach 2: Next.js _next/data — correct format confirmed via DevTools ──
  // URL format: /_next/data/{buildId}/browse/{slug}.json?slug={seg1}&slug={seg2}&page={n}
  if (buildId) {
    try {
      const slugQuery = slugParts.map((s) => `slug=${encodeURIComponent(s)}`).join('&');
      const url = `${BASE}/_next/data/${buildId}/browse/${slugPath}.json?${slugQuery}&page=${pageNumber}`;
      const r = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'x-nextjs-data': '1',
          'Next-Url': `/browse/${slugPath}?page=${pageNumber}`,
          'Cache-Control': 'no-cache',
        },
      });
      if (r.ok) {
        const j = await r.json();
        const pp = j?.pageProps;
        if (pp?.searchResults?.results?.length) {
          console.log(`[_next/data p${pageNumber}] ${slugPath} → first id: ${pp.searchResults.results[0]?.id}`);
          return pp;
        }
        console.warn(`[_next/data p${pageNumber}] ${slugPath} ok but empty results`);
      } else {
        console.warn(`[_next/data p${pageNumber}] HTTP ${r.status} for ${url}`);
      }
    } catch (e) {
      console.warn('[_next/data] fetch error:', e.message);
    }
  }

  // ── Approach 3: Direct HTML fetch with cache-buster (last resort) ──
  try {
    const html = await fetchHtml(`${BASE}/browse/${slugPath}?page=${pageNumber}&_cb=${Date.now()}`);
    const data = parseNextData(html);
    const sr = data?.props?.pageProps?.searchResults;
    if (sr?.results?.length) {
      console.log(`[HTML p${pageNumber}] ${slugPath} → first id: ${sr.results[0]?.id}`);
      return { searchResults: sr };
    }
  } catch (e) {
    console.warn('[HTML fallback] fetch error:', e.message);
  }

  return null;
}

function parseNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Extract product URLs from a results array
// ---------------------------------------------------------------------------

function extractProductUrlsFromResults(results) {
  const urls = new Set();
  for (const p of (results || [])) {
    if (!p.id) continue;
    const slug = p.urlFriendlyName || p.seoToken || String(p.id);
    urls.add(`${BASE}/product/${slug}-${p.id}`);
  }
  return urls;
}

function extractProductUrlsFromHtml(html) {
  const urls = new Set();
  const re = /href="(\/product\/[a-z0-9][a-z0-9-]*-\d{4,})"/g;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(BASE + m[1]);
  return urls;
}

// ---------------------------------------------------------------------------
// Get total page count from a searchResults object
// ---------------------------------------------------------------------------

function getTotalPages(sr) {
  try {
    if (!sr) return 1;
    const total    = sr.noOfResults || sr.totalNoOfResults || 0;
    const pageSize = sr.pageSize    || 48;
    return Math.max(1, Math.ceil(total / pageSize));
  } catch { return 1; }
}

// ---------------------------------------------------------------------------
// Extract TOP-LEVEL category URLs from /browse page
// ---------------------------------------------------------------------------

function extractTopLevelCategories(html, data) {
  const cats = new Set();

  if (data) {
    const walk = (items) => {
      if (!Array.isArray(items)) return;
      for (const c of items) {
        const slug = c.seoToken || c.slug || c.urlFriendlyName;
        if (slug && !SKIP_SLUGS.has(slug) && !slug.includes('/')) {
          cats.add(`${BASE}/browse/${slug}`);
        }
        // Do NOT recurse — we'll fetch sub-categories separately
      }
    };
    walk(
      data?.props?.pageProps?.categories ||
      data?.props?.pageProps?.headerCategories ||
      []
    );
  }

  // HTML fallback — only top-level /browse/slug (no second slash)
  const re = /href="(\/browse\/([a-z][a-z0-9-]+))"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const topSlug = m[2];
    if (!SKIP_SLUGS.has(topSlug)) cats.add(BASE + m[1]);
  }

  return [...cats];
}

// ---------------------------------------------------------------------------
// Discover sub-categories by fetching each top-level category page
// ---------------------------------------------------------------------------

async function discoverSubCategories(topLevelCats) {
  const subCats = new Set();

  await runWithConcurrency(topLevelCats.map((catUrl) => async () => {
    try {
      const topSlug = catUrl.replace(`${BASE}/browse/`, '');
      const html    = await fetchHtml(catUrl);
      const data    = parseNextData(html);

      // From __NEXT_DATA__ — sub-categories are under pageProps.categories or similar
      const subList =
        data?.props?.pageProps?.categories      ||
        data?.props?.pageProps?.subCategories   ||
        data?.props?.pageProps?.leftHandMenu?.categories || [];

      for (const c of subList) {
        const slug = c.seoToken || c.slug || c.urlFriendlyName;
        if (!slug || SKIP_SLUGS.has(slug.split('/')[0])) continue;
        // Build full path: slug might be just "breakfast-foods" or "pantry/breakfast-foods"
        const full = slug.includes('/') ? slug : `${topSlug}/${slug}`;
        subCats.add(`${BASE}/browse/${full}`);
      }

      // HTML regex — links of form /browse/{topSlug}/{subSlug}
      const re = new RegExp(
        `href="(/browse/${topSlug}/([a-z0-9][a-z0-9-]+))(?:[?#][^"]*)?"`,'g'
      );
      let m;
      while ((m = re.exec(html)) !== null) {
        subCats.add(BASE + m[1]);
      }
    } catch (e) {
      console.warn('[Discoverer] Sub-cat discovery failed for', catUrl, e.message);
    }
  }), 5);

  return [...subCats];
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setStatus(text) {
  document.getElementById('progressText').textContent = text;
}

function updateStats() {
  const total    = allUrls.size;
  const known    = [...allUrls].filter((u) => knownIds.has(extractId(u))).length;
  const newCount = total - known;

  document.getElementById('statTotal').textContent      = total.toLocaleString();
  document.getElementById('statKnown').textContent      = known.toLocaleString();
  document.getElementById('statNew').textContent        = newCount.toLocaleString();
  document.getElementById('statCategories').textContent = categoriesList.length;
}

function updateProgress() {
  const done = categoriesList.filter((c) => {
    const tr = categoryRows[c];
    return tr && tr.dataset.status === 'done';
  }).length;
  const pct = categoriesList.length > 0 ? (done / categoriesList.length) * 100 : 0;
  document.getElementById('progressFill').style.width = pct.toFixed(1) + '%';
  setStatus(`${done} / ${categoriesList.length} categories crawled`);
}

function addCategoryRow(catUrl) {
  const slug = catUrl.replace(`${BASE}/browse/`, '');
  const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const tr = document.createElement('tr');
  tr.dataset.status = 'pending';
  tr.innerHTML = `
    <td>${name}</td>
    <td style="text-align:center" class="td-pages">—</td>
    <td style="text-align:center" class="td-found">0</td>
    <td style="text-align:center" class="td-new">—</td>
    <td style="text-align:center" class="td-status"><span class="badge badge-pending">Pending</span></td>
  `;
  document.getElementById('categoryBody').appendChild(tr);
  categoryRows[catUrl] = tr;
}

function updateCategoryRow(catUrl, { pages, found, status }) {
  const tr = categoryRows[catUrl];
  if (!tr) return;

  if (pages  !== undefined) tr.querySelector('.td-pages').textContent = pages;
  if (found  !== undefined) tr.querySelector('.td-found').textContent = found.toLocaleString();
  if (status !== undefined) {
    tr.dataset.status = status;
    const badgeCls = {
      pending: 'badge-pending', crawling: 'badge-crawling',
      done: 'badge-done', error: 'badge-error',
    }[status] || 'badge-pending';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    tr.querySelector('.td-status').innerHTML = `<span class="badge ${badgeCls}">${label}</span>`;
  }

  const foundCount = parseInt(tr.querySelector('.td-found').textContent.replace(/,/g, '')) || 0;
  if (foundCount > 0 && status === 'done') {
    tr.querySelector('.td-new').textContent = '✓';
  }
}

// ---------------------------------------------------------------------------
// Crawl a single category (all pages)
// Tries _next/data API for pagination; stops early if pages are identical
// ---------------------------------------------------------------------------

async function crawlCategory(catUrl) {
  if (!isRunning) return;
  updateCategoryRow(catUrl, { status: 'crawling' });

  const slugParts = catUrl.replace(`${BASE}/browse/`, '').split('/');
  let totalFound = 0;
  let page1FirstId = null;

  try {
    // Page 1 — use fetchPageData first, fall back to HTML
    let sr1, urls1;
    const pp1 = await fetchPageData(slugParts, 1);

    if (pp1?.searchResults?.results?.length) {
      sr1   = pp1.searchResults;
      urls1 = extractProductUrlsFromResults(sr1.results);
      page1FirstId = sr1.results[0]?.id;
    } else {
      const html1 = await fetchHtml(catUrl);
      const data1 = parseNextData(html1);
      sr1   = data1?.props?.pageProps?.searchResults;
      urls1 = extractProductUrlsFromResults(sr1?.results);
      page1FirstId = sr1?.results?.[0]?.id;
      if (urls1.size === 0) urls1 = extractProductUrlsFromHtml(html1);
    }

    const pages = getTotalPages(sr1);
    for (const u of urls1) allUrls.add(u);
    totalFound += urls1.size;
    updateCategoryRow(catUrl, { pages, found: totalFound });
    updateStats();

    // Pages 2..N
    for (let p = 2; p <= pages; p++) {
      if (!isRunning) break;
      await sleep(PAGE_DELAY + Math.random() * 300);

      const pp = await fetchPageData(slugParts, p);
      if (!pp?.searchResults?.results?.length) break;

      const results = pp.searchResults.results;

      // Stop if server returns same page-1 data (pagination broken)
      if (results[0]?.id && results[0].id === page1FirstId) {
        console.log(`[Discoverer] ${catUrl}: pagination broken at p${p}, stopping`);
        break;
      }

      const urls = extractProductUrlsFromResults(results);
      for (const u of urls) allUrls.add(u);
      totalFound += urls.size;
      updateCategoryRow(catUrl, { found: totalFound });
      updateStats();
    }

    updateCategoryRow(catUrl, { status: 'done' });
  } catch (err) {
    console.error(`[Discoverer] Error on ${catUrl}:`, err);
    updateCategoryRow(catUrl, { status: 'error' });
  }

  updateProgress();
}

// ---------------------------------------------------------------------------
// Run N workers against a queue
// ---------------------------------------------------------------------------

async function runWithConcurrency(tasks, n) {
  const queue = [...tasks];
  const worker = async () => {
    while (queue.length > 0 && isRunning) {
      const task = queue.shift();
      if (task) await task();
      await sleep(200);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}

// ---------------------------------------------------------------------------
// Main discovery flow
// ---------------------------------------------------------------------------

async function startDiscovery() {
  isRunning = true;
  allUrls.clear();
  categoryRows = {};
  categoriesList = [];
  buildId = null;

  document.getElementById('categoryBody').innerHTML = '';
  document.getElementById('tableCard').style.display = 'block';
  document.getElementById('btnStart').disabled    = true;
  document.getElementById('btnStop').disabled     = false;
  document.getElementById('btnDownload').disabled = true;

  setStatus('Fetching category list from coles.com.au/browse …');

  try {
    const browseHtml = await fetchHtml(`${BASE}/browse`);
    const browseData = parseNextData(browseHtml);
    buildId = browseData?.buildId || null;
    console.log('[Discoverer] buildId:', buildId);

    const topLevelCats = extractTopLevelCategories(browseHtml, browseData);

    if (topLevelCats.length === 0) {
      setStatus('❌ No categories found. Make sure you are logged into Coles in this browser.');
      isRunning = false;
      document.getElementById('btnStart').disabled = false;
      return;
    }

    // Expand to sub-categories so each category has ≤ ~50 products (fits on 1 page)
    setStatus(`Found ${topLevelCats.length} top-level categories. Discovering sub-categories…`);
    const subCats = await discoverSubCategories(topLevelCats);

    if (subCats.length > topLevelCats.length) {
      categoriesList = subCats;
      console.log('[Discoverer] Using', subCats.length, 'sub-categories');
    } else {
      // Sub-cat discovery failed — fall back to top-level
      categoriesList = topLevelCats;
      console.warn('[Discoverer] Sub-cat discovery found no results, using top-level categories');
    }

    updateStats();
    for (const cat of categoriesList) addCategoryRow(cat);
    setStatus(`Found ${categoriesList.length} categories. Starting crawl…`);

    const tasks = categoriesList.map((cat) => () => crawlCategory(cat));
    await runWithConcurrency(tasks, CONCURRENCY);

  } catch (err) {
    console.error('[Discoverer] Fatal error:', err);
    setStatus('❌ Error: ' + err.message);
  }

  isRunning = false;
  document.getElementById('btnStart').disabled    = false;
  document.getElementById('btnStop').disabled     = true;
  document.getElementById('btnDownload').disabled = false;
  updateStats();
  updateProgress();

  const newCount = [...allUrls].filter((u) => !knownIds.has(extractId(u))).length;
  setStatus(`✅ Done! ${allUrls.size.toLocaleString()} URLs found — ${newCount.toLocaleString()} are new.`);
}

// ---------------------------------------------------------------------------
// Download new URLs
// ---------------------------------------------------------------------------

function downloadNewUrls() {
  const newUrls = [...allUrls].filter((u) => {
    const id = extractId(u);
    return !id || !knownIds.has(id);
  });

  if (newUrls.length === 0) {
    alert('No new URLs found — everything has already been scraped!');
    return;
  }

  const blob = new Blob([newUrls.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `coles-new-urls-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

document.getElementById('btnStart').addEventListener('click', startDiscovery);

document.getElementById('btnStop').addEventListener('click', () => {
  isRunning = false;
  document.getElementById('btnStop').disabled     = true;
  document.getElementById('btnStart').disabled    = false;
  document.getElementById('btnDownload').disabled = false;
  setStatus('Stopped early. You can still download the URLs found so far.');
});

document.getElementById('btnDownload').addEventListener('click', downloadNewUrls);

document.getElementById('knownFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      knownIds.clear();
      for (const p of data) {
        const id = extractId(p.url || '') || String(p.coles_id || '');
        if (id) knownIds.add(id);
      }
      document.getElementById('knownStatus').textContent =
        `✅ ${knownIds.size.toLocaleString()} known product IDs loaded — new URLs will be highlighted`;
      updateStats();
    } catch {
      document.getElementById('knownStatus').textContent = '❌ Invalid JSON file';
    }
  };
  reader.readAsText(file);
});
