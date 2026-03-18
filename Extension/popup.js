/**
 * Coles Product Scraper - Popup Script
 */

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const inputSection    = document.getElementById('inputSection');
const statusSection   = document.getElementById('statusSection');
const controlsSection = document.getElementById('controlsSection');
const downloadSection = document.getElementById('downloadSection');

const fileInput       = document.getElementById('fileInput');
const urlInput        = document.getElementById('urlInput');
const urlCount        = document.getElementById('urlCount');
const btnLoadUrls     = document.getElementById('btnLoadUrls');

const progressText    = document.getElementById('progressText');
const progressPct     = document.getElementById('progressPct');
const progressBar     = document.getElementById('progressBar');
const statScraped     = document.getElementById('statScraped');
const statFailed      = document.getElementById('statFailed');
const statPending     = document.getElementById('statPending');
const currentUrlWrap  = document.getElementById('currentUrlWrap');
const currentUrlEl    = document.getElementById('currentUrl');

const btnStart        = document.getElementById('btnStart');
const btnPause        = document.getElementById('btnPause');
const btnResume       = document.getElementById('btnResume');
const btnStop         = document.getElementById('btnStop');
const btnReset        = document.getElementById('btnReset');

const btnDownloadJSON = document.getElementById('btnDownloadJSON');
const btnDownloadCSV  = document.getElementById('btnDownloadCSV');
const stallBanner     = document.getElementById('stallBanner');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      resolve(response);
    });
  });
}

function parseUrls(text) {
  return text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('https://www.coles.com.au/product/'));
}

// ---------------------------------------------------------------------------
// UI update
// ---------------------------------------------------------------------------

function updateUI(status) {
  if (!status) return;

  const { stats, isRunning, isPaused, isStalled, currentUrl, hasUrls } = status;
  const total    = stats.total    || 0;
  const scraped  = stats.scraped  || 0;
  const failed   = stats.failed   || 0;
  const pending  = Math.max(0, total - scraped - failed);
  const pct      = total > 0 ? Math.round((scraped / total) * 100) : 0;

  // Progress
  progressText.textContent = `${scraped} / ${total} products scraped`;
  progressPct.textContent  = `${pct}%`;
  progressBar.style.width  = `${pct}%`;
  statScraped.textContent  = scraped;
  statFailed.textContent   = failed;
  statPending.textContent  = pending;

  // Current URL
  if (currentUrl) {
    currentUrlWrap.classList.remove('hidden');
    currentUrlEl.textContent = currentUrl;
    currentUrlEl.title = currentUrl;
  } else {
    currentUrlWrap.classList.add('hidden');
  }

  // Show/hide main sections
  const showInputSection = !hasUrls && !isRunning && !isPaused;
  inputSection.classList.toggle('hidden', !showInputSection);
  statusSection.classList.toggle('hidden', !hasUrls && !isRunning && !isPaused);

  // Stall banner
  stallBanner.classList.toggle('hidden', !isStalled);

  // Button visibility
  btnStart.classList.toggle('hidden',  isRunning || isPaused || !hasUrls);
  btnPause.classList.toggle('hidden',  !isRunning || isPaused);
  btnResume.classList.toggle('hidden', !isPaused);
  btnStop.classList.toggle('hidden',   !isRunning && !isPaused);

  // Download section
  downloadSection.classList.toggle('hidden', scraped === 0);
}

// ---------------------------------------------------------------------------
// URL loading
// ---------------------------------------------------------------------------

function handleRawText(text) {
  const urls = parseUrls(text);
  if (urls.length === 0) {
    urlCount.innerHTML = '<span style="color:#e01a22">No valid Coles product URLs found.</span>';
    return;
  }
  urlCount.innerHTML = `<span>${urls.length}</span> URL${urls.length !== 1 ? 's' : ''} ready to load`;

  sendMsg({ type: 'SET_URLS', urls }).then((resp) => {
    if (resp && resp.ok) {
      urlInput.value = '';
      refreshStatus();
    }
  });
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => handleRawText(e.target.result);
  reader.readAsText(file);
  fileInput.value = '';
});

urlInput.addEventListener('input', () => {
  const urls = parseUrls(urlInput.value);
  if (urlInput.value.trim() === '') {
    urlCount.textContent = '';
    return;
  }
  urlCount.innerHTML = urls.length > 0
    ? `<span>${urls.length}</span> valid URL${urls.length !== 1 ? 's' : ''} detected`
    : 'No valid Coles product URLs detected';
});

btnLoadUrls.addEventListener('click', () => {
  const text = urlInput.value;
  if (!text.trim()) {
    urlCount.innerHTML = '<span style="color:#e01a22">Please paste some URLs first.</span>';
    return;
  }
  handleRawText(text);
});

// ---------------------------------------------------------------------------
// Control buttons
// ---------------------------------------------------------------------------

btnStart.addEventListener('click', async () => {
  await sendMsg({ type: 'START' });
  refreshStatus();
});

btnPause.addEventListener('click', async () => {
  await sendMsg({ type: 'PAUSE' });
  refreshStatus();
});

btnResume.addEventListener('click', async () => {
  await sendMsg({ type: 'RESUME' });
  refreshStatus();
});

btnStop.addEventListener('click', async () => {
  await sendMsg({ type: 'STOP' });
  refreshStatus();
});

btnReset.addEventListener('click', async () => {
  if (!confirm('Reset everything? This will clear all results and the queue.')) return;
  await sendMsg({ type: 'RESET' });
  urlInput.value = '';
  urlCount.textContent = '';
  refreshStatus();
});

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

async function getAllResults() {
  // Merge in-memory results with persisted results (background may have more)
  const [bgResp, storageData] = await Promise.all([
    sendMsg({ type: 'GET_RESULTS' }),
    new Promise((resolve) => chrome.storage.local.get('coles_results', resolve)),
  ]);

  const memResults     = (bgResp && bgResp.results) ? bgResp.results : [];
  const storedResults  = storageData.coles_results || [];

  // Merge, deduplicate by URL (in-memory wins for freshest data)
  const map = new Map();
  for (const r of storedResults) { if (r.url) map.set(r.url, r); }
  for (const r of memResults)    { if (r.url) map.set(r.url, r); }
  return [...map.values()];
}

const CSV_HEADERS = [
  'url', 'coles_id', 'gtin', 'name', 'brand', 'size',
  'price_now', 'price_was', 'price_comparable',
  'category', 'sub_category', 'description', 'long_description',
  'ingredients', 'allergens', 'lifestyle_tags', 'country_of_origin',
  'nutrition_json', 'image_url', 'scraped_at',
];

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if the value contains a comma, newline, or double-quote
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function resultsToCSV(data) {
  const rows = [CSV_HEADERS.join(',')];
  for (const item of data) {
    const row = CSV_HEADERS.map((h) => escapeCsvField(item[h]));
    rows.push(row.join(','));
  }
  return rows.join('\r\n');
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename,
    saveAs: true,
  }, () => {
    // Revoke after a short delay to allow download to start
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

btnDownloadJSON.addEventListener('click', async () => {
  btnDownloadJSON.disabled = true;
  btnDownloadJSON.textContent = '⏳ Preparing...';
  try {
    const data = await getAllResults();
    const json = JSON.stringify(data, null, 2);
    const ts   = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    triggerDownload(json, `coles-products-${ts}.json`, 'application/json');
  } finally {
    btnDownloadJSON.disabled = false;
    btnDownloadJSON.textContent = '⬇ Download JSON';
  }
});

btnDownloadCSV.addEventListener('click', async () => {
  btnDownloadCSV.disabled = true;
  btnDownloadCSV.textContent = '⏳ Preparing...';
  try {
    const data = await getAllResults();
    const csv  = resultsToCSV(data);
    const ts   = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    triggerDownload(csv, `coles-products-${ts}.csv`, 'text/csv');
  } finally {
    btnDownloadCSV.disabled = false;
    btnDownloadCSV.textContent = '⬇ Download CSV';
  }
});

// ---------------------------------------------------------------------------
// Status polling
// ---------------------------------------------------------------------------

async function refreshStatus() {
  const status = await sendMsg({ type: 'GET_STATUS' });
  updateUI(status);
}

// Poll every 1.5 seconds while popup is open
refreshStatus();
const pollInterval = setInterval(refreshStatus, 1500);

// Clean up on unload
window.addEventListener('unload', () => clearInterval(pollInterval));

// Discover link
document.getElementById('discoverLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('discover.html') });
});
