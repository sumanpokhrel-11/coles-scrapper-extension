/**
 * Coles Product Scraper - Background Service Worker (MV3)
 *
 * Manages the scrape queue, navigates a background tab through product URLs,
 * collects results, and persists everything to chrome.storage.local so that
 * state survives service-worker restarts.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {
  queue: [],        // URLs still to scrape
  done: new Set(),  // URLs completed
  failed: [],       // URLs that failed / had no data
  stats: { total: 0, scraped: 0, failed: 0 },
  isRunning: false,
  isPaused: false,
  scrapeTabId: null,
  currentUrl: null,
};

// In-memory results cache (also mirrored to storage every PERSIST_EVERY items)
let results = [];
const PERSIST_EVERY = 50;
let resultsSinceLastPersist = 0;

// ---------------------------------------------------------------------------
// Stall detection
// ---------------------------------------------------------------------------

const STALL_SECONDS = 20;
let lastProgressTime = Date.now();
let stallAlerted = false;

function resetStallTimer() {
  lastProgressTime = Date.now();
  stallAlerted = false;
  // Restart the watchdog alarm
  chrome.alarms.create('stall_watchdog', { delayInMinutes: STALL_SECONDS / 60 });
}

async function triggerStallAlert() {
  if (stallAlerted) return;
  stallAlerted = true;

  // Auto-pause scraping
  state.isPaused = true;
  await persistState();

  // Desktop notification
  chrome.notifications.create('stall_alert', {
    type: 'basic',
    iconUrl: 'icon.png',
    title: '⚠️ Coles Scraper — Paused',
    message: 'No progress for 20 seconds. Check the scraper tab for a human verification prompt.',
    priority: 2,
    requireInteraction: true,
  });

  // Play beep via offscreen document
  try {
    const existing = await chrome.offscreen.hasDocument?.() ?? false;
    if (!existing) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Alert user when scraping stalls',
      });
    }
    setTimeout(() => chrome.runtime.sendMessage({ type: 'PLAY_BEEP' }), 100);
    setTimeout(async () => {
      try { await chrome.offscreen.closeDocument(); } catch (_) {}
    }, 4000);
  } catch (err) {
    console.warn('[Coles Scraper] Offscreen audio failed:', err);
  }
}

// Alarm fires when scraping has stalled for STALL_SECONDS
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'stall_watchdog') return;
  if (!state.isRunning || state.isPaused) return;
  const elapsed = (Date.now() - lastProgressTime) / 1000;
  if (elapsed >= STALL_SECONDS) {
    await triggerStallAlert();
  } else {
    // Rearm for remaining time
    chrome.alarms.create('stall_watchdog', {
      delayInMinutes: (STALL_SECONDS - elapsed) / 60,
    });
  }
});

// Also detect immediately if the scrape tab navigates to a non-product URL
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== state.scrapeTabId) return;
  if (changeInfo.status !== 'complete') return;
  if (!state.isRunning || state.isPaused) return;
  const url = tab.url || '';
  if (url && !url.includes('coles.com.au/product/')) {
    await triggerStallAlert();
  }
});

// Clicking the notification resumes scraping
chrome.notifications.onClicked.addListener((id) => {
  if (id !== 'stall_alert') return;
  chrome.notifications.clear('stall_alert');
  state.isPaused = false;
  stallAlerted = false;
  persistState();
  resetStallTimer();
  processNext();
});

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function serializeState() {
  return {
    queue: state.queue,
    done: [...state.done],
    failed: state.failed,
    stats: state.stats,
    isRunning: state.isRunning,
    isPaused: state.isPaused,
    scrapeTabId: state.scrapeTabId,
    currentUrl: state.currentUrl,
  };
}

async function persistState() {
  return chrome.storage.local.set({ coles_state: serializeState() });
}

async function persistResults() {
  return chrome.storage.local.set({ coles_results: results });
}

async function loadStateFromStorage() {
  const data = await chrome.storage.local.get(['coles_state', 'coles_results']);

  if (data.coles_state) {
    const s = data.coles_state;
    state.queue = s.queue || [];
    state.done = new Set(s.done || []);
    state.failed = s.failed || [];
    state.stats = s.stats || { total: 0, scraped: 0, failed: 0 };
    // Don't restore isRunning – we should not auto-resume after a crash
    state.isRunning = false;
    state.isPaused = s.isPaused || false;
    // Tab from previous session is gone
    state.scrapeTabId = null;
    state.currentUrl = s.currentUrl || null;
  }

  if (data.coles_results) {
    results = data.coles_results;
  }
}

// ---------------------------------------------------------------------------
// Tab management
// ---------------------------------------------------------------------------

async function getOrCreateScrapeTab(url) {
  if (state.scrapeTabId !== null) {
    try {
      const tab = await chrome.tabs.get(state.scrapeTabId);
      if (tab) {
        await chrome.tabs.update(state.scrapeTabId, { url });
        return state.scrapeTabId;
      }
    } catch (_) {
      // Tab no longer exists
      state.scrapeTabId = null;
    }
  }

  const tab = await chrome.tabs.create({ url, active: false });
  state.scrapeTabId = tab.id;
  await persistState();
  return tab.id;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.scrapeTabId) {
    state.scrapeTabId = null;
  }
});

// ---------------------------------------------------------------------------
// Scrape queue processing
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processNext() {
  if (!state.isRunning || state.isPaused) return;
  if (state.queue.length === 0) {
    state.isRunning = false;
    state.currentUrl = null;
    await persistState();
    return;
  }

  const url = state.queue[0];
  state.currentUrl = url;
  await persistState();

  // Random human-like delay before navigating
  const waitMs = 1500 + Math.floor(Math.random() * 1000);
  await delay(waitMs);

  // Check again after delay (user may have paused/stopped)
  if (!state.isRunning || state.isPaused) return;

  resetStallTimer(); // start 20-second watchdog for this navigation

  try {
    await getOrCreateScrapeTab(url);
  } catch (err) {
    console.error('[Coles Scraper] Failed to navigate tab:', err);
    // Treat as failure and move on
    state.queue.shift();
    state.failed.push(url);
    state.stats.failed = (state.stats.failed || 0) + 1;
    await persistState();
    processNext();
  }
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error('[Coles Scraper] Message handler error:', err);
    sendResponse({ error: String(err) });
  });
  return true; // keep message channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    // -----------------------------------------------------------------------
    case 'SET_URLS': {
      const incoming = (message.urls || []).filter(
        (u) => typeof u === 'string' && u.startsWith('https://www.coles.com.au/product/')
      );
      // Filter out already-done URLs
      const newUrls = incoming.filter((u) => !state.done.has(u));
      state.queue = newUrls;
      state.stats.total = state.done.size + newUrls.length + state.failed.length;
      state.stats.scraped = state.done.size;
      state.stats.failed = state.failed.length;
      await persistState();
      return { ok: true, queued: newUrls.length };
    }

    // -----------------------------------------------------------------------
    case 'START': {
      if (state.isRunning) return { ok: false, reason: 'already running' };
      state.isRunning = true;
      state.isPaused = false;
      await persistState();
      processNext();
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    case 'PAUSE': {
      state.isPaused = true;
      chrome.alarms.clear('stall_watchdog');
      await persistState();
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    case 'RESUME': {
      state.isPaused = false;
      await persistState();
      processNext();
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    case 'STOP': {
      state.isRunning = false;
      state.isPaused = false;
      state.currentUrl = null;
      chrome.alarms.clear('stall_watchdog');
      if (state.scrapeTabId !== null) {
        try {
          await chrome.tabs.remove(state.scrapeTabId);
        } catch (_) {}
        state.scrapeTabId = null;
      }
      await persistState();
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    case 'RESET': {
      state.queue = [];
      state.done = new Set();
      state.failed = [];
      state.stats = { total: 0, scraped: 0, failed: 0 };
      state.isRunning = false;
      state.isPaused = false;
      state.currentUrl = null;
      if (state.scrapeTabId !== null) {
        try {
          await chrome.tabs.remove(state.scrapeTabId);
        } catch (_) {}
        state.scrapeTabId = null;
      }
      results = [];
      resultsSinceLastPersist = 0;
      await chrome.storage.local.clear();
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    case 'GET_STATUS': {
      return {
        stats: state.stats,
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        isStalled: stallAlerted,
        currentUrl: state.currentUrl,
        queueLength: state.queue.length,
        hasUrls: state.queue.length > 0 || state.done.size > 0 || state.failed.length > 0,
      };
    }

    // -----------------------------------------------------------------------
    case 'GET_RESULTS': {
      return { results };
    }

    // -----------------------------------------------------------------------
    case 'PRODUCT_DATA': {
      const url = message.data?.url;
      if (!url) break;

      resetStallTimer(); // got a product — reset watchdog

      // Always shift queue[0] — the URL we navigated to.
      // Using filter(u !== url) breaks when Coles redirects
      // (e.g. rufus-coco-... → rufus-and-coco-...), causing an infinite loop.
      state.queue.shift();
      state.done.add(url);
      state.stats.scraped = state.done.size;

      // Store result
      results.push(message.data);
      resultsSinceLastPersist++;

      // Persist results every PERSIST_EVERY items
      if (resultsSinceLastPersist >= PERSIST_EVERY) {
        await persistResults();
        resultsSinceLastPersist = 0;
      }

      await persistState();
      processNext();
      break;
    }

    // -----------------------------------------------------------------------
    case 'PAGE_NO_DATA': {
      const url = message.url;
      if (!url) break;

      resetStallTimer(); // page responded (even with no data) — reset watchdog

      // Same redirect-safe fix: shift queue[0] instead of filtering by URL
      const queuedUrl = state.queue.shift();
      state.failed.push(queuedUrl || url);
      state.stats.failed = state.failed.length;

      await persistState();
      processNext();
      break;
    }

    default:
      return { error: 'Unknown message type' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Initialise state when service worker starts
// ---------------------------------------------------------------------------

loadStateFromStorage().catch((err) =>
  console.error('[Coles Scraper] Failed to load state from storage:', err)
);
