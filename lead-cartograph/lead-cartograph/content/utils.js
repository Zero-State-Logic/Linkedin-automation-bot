// content/utils.js — loaded FIRST. Sets up the shared namespace on window.Cartograph.
// All other content scripts read/write through this object.

(function () {
  if (window.Cartograph) return; // already initialized

  // ---------- Inline message constants (in sync with lib/constants.js) ----------
  const MSG = {
    CONTENT_PING: 'content_ping',
    CHECK_LOGIN: 'check_login',
    STOP_CONTENT_TASK: 'stop_content_task',
    EXTRACT_CONNECTIONS: 'extract_connections',
    EXTRACT_CAPELLA_PAGE_LINKS: 'extract_capella_page_links',
    COLLECT_EDUCATION: 'collect_education',
    COLLECT_NAME_HEADLINE: 'collect_name_headline',
    COLLECT_LOCATION: 'collect_location',
    COLLECT_CONTACT: 'collect_contact',
    LINKS_BATCH: 'links_batch',
    CONTENT_TASK_COMPLETE: 'content_task_complete',
    CONTENT_TASK_FAILED: 'content_task_failed',
    TASK_PROGRESS: 'task_progress'
  };

  const STATE = {
    running: false,
    cancelled: false
  };

  // ---------- Utilities ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const jitter = (base, spread) => Math.max(100, base + (Math.random() * 2 - 1) * spread);

  function log(...args) { console.log('[Cartograph]', ...args); }
  function warn(...args) { console.warn('[Cartograph]', ...args); }
  function err(...args) { console.error('[Cartograph]', ...args); }

  // ---------- Login / page checks ----------
  function isLoggedOut() {
    const p = window.location.pathname || '';
    return p.startsWith('/login') ||
           p.startsWith('/checkpoint') ||
           p.startsWith('/uas/') ||
           p.startsWith('/authwall');
  }

  function isRateLimited() {
    // Light heuristic; LinkedIn shows blocking UI in various ways
    const text = (document.body.textContent || '').toLowerCase();
    return text.includes('temporarily restricted') ||
           text.includes('unusual activity') ||
           text.includes('please solve this puzzle');
  }

  function isOnConnectionsPage() {
    return (window.location.pathname || '').includes('/mynetwork/invite-connect/connections');
  }

  function isOnCapellaPeoplePage() {
    return (window.location.pathname || '').includes('/school/capella-university/people');
  }

  function isOnProfilePage() {
    return /^\/in\/[^/]+\/?$/.test(window.location.pathname || '');
  }

  function isOnEducationDetailPage() {
    return /^\/in\/[^/]+\/details\/education\/?$/.test(window.location.pathname || '');
  }

  // ---------- URL normalization ----------
  function normalizeProfileUrl(href) {
    if (!href) return null;
    try {
      let u = String(href).trim().toLowerCase();
      u = u.split('?')[0].split('#')[0];
      if (u.endsWith('/')) u = u.slice(0, -1);
      u = u.replace('://linkedin.com', '://www.linkedin.com');
      u = u.replace(/^http:/, 'https:');
      const m = u.match(/^https:\/\/www\.linkedin\.com\/in\/([^/]+)$/);
      if (!m) return null;
      return u;
    } catch {
      return null;
    }
  }

  // Get the profile URL of the *current page*, normalized
  function getCurrentProfileUrl() {
    const m = window.location.pathname.match(/^\/in\/([^/]+)/);
    if (!m) return null;
    return `https://www.linkedin.com/in/${m[1]}`;
  }

  // ---------- DOM helpers ----------
  function extractProfileLinks() {
    const anchors = document.querySelectorAll('a[href*="/in/"]');
    const set = new Set();
    anchors.forEach((a) => {
      const url = normalizeProfileUrl(a.getAttribute('href') || a.href);
      if (url) set.add(url);
    });
    return Array.from(set);
  }

  async function waitForInitialLinks(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (STATE.cancelled) return false;
      if (document.querySelectorAll('a[href*="/in/"]').length > 3) return true;
      await sleep(500);
    }
    return false;
  }

  async function humanScroll() {
    const vh = window.innerHeight;
    const small = Math.random() < 0.15;
    const distance = small
      ? vh * (0.15 + Math.random() * 0.10)
      : vh * (0.70 + Math.random() * 0.45);
    window.scrollBy({ top: distance, behavior: 'smooth' });
    await sleep(jitter(800, 250));
  }

  async function scrollIntoView(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(jitter(700, 200));
  }

  // Best-effort: query first matching element among multiple selectors
  function queryAny(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch {}
    }
    return null;
  }

  function queryAllAny(selectors, root = document) {
    const results = [];
    for (const sel of selectors) {
      try {
        root.querySelectorAll(sel).forEach((el) => results.push(el));
      } catch {}
    }
    // Dedup by element identity
    return Array.from(new Set(results));
  }

  // ---------- Profile heading detection (handles h2 OR h1) ----------
  // LinkedIn migrated name from h1 → h2 in late 2025. We handle both.
  function findNameElement() {
    // Strategy 1: h2/h1 inside an anchor to a /in/ profile URL (most reliable)
    const profileLinks = document.querySelectorAll('main a[href*="/in/"]');
    for (const link of profileLinks) {
      const h = link.querySelector('h2, h1');
      if (h && (h.textContent || '').trim().length > 1) return h;
    }
    // Strategy 2: any h2/h1 in main that isn't a known section header
    const SECTION_NAMES = /^(About|Experience|Education|Skills|Activity|Featured|Recommendations|Volunteer|Languages|Honors|Certifications|Projects|Publications|Patents|Posts|Interests|Accomplishments|Awards|Test scores|Courses|Highlights|People you may know|More profiles for you)/i;
    const headings = document.querySelectorAll('main h2, main h1');
    for (const h of headings) {
      const txt = (h.textContent || '').trim();
      if (txt && txt.length > 1 && txt.length < 100 && !SECTION_NAMES.test(txt)) return h;
    }
    return null;
  }

  // ---------- Strip ", USA" / ", United States" from location ----------
  function stripUsaSuffix(loc) {
    if (!loc) return '';
    return loc.replace(/\s*,\s*(USA|U\.S\.A\.?|United States|US)\s*$/i, '').trim();
  }

  // ---------- Education date parsing ----------
  // Returns: { startYear, endYear, isPresent, isExpected, raw }
  function parseEducationDates(dateStr) {
    const out = { raw: (dateStr || '').trim() };
    if (!out.raw) return out;
    const s = out.raw.replace(/\s+/g, ' ');

    let m;
    // "Expected May 2026" / "Expected 2026"
    m = s.match(/Expected\s+(?:\w+\s+)?(\d{4})/i);
    if (m) { out.endYear = parseInt(m[1], 10); out.isExpected = true; return out; }

    // "Issued May 2024" / "Issued 2024"
    m = s.match(/Issued\s+(?:\w+\s+)?(\d{4})/i);
    if (m) { out.endYear = parseInt(m[1], 10); return out; }

    // "Sep 2020 - Present" or "2020 - Present"
    m = s.match(/(?:\w+\s+)?(\d{4})\s*[-–—]\s*Present/i);
    if (m) { out.startYear = parseInt(m[1], 10); out.isPresent = true; return out; }

    // "Sep 2020 - May 2024" or "2020 - 2024"
    m = s.match(/(?:\w+\s+)?(\d{4})\s*[-–—]\s*(?:\w+\s+)?(\d{4})/);
    if (m) {
      out.startYear = parseInt(m[1], 10);
      out.endYear = parseInt(m[2], 10);
      return out;
    }

    // Standalone year
    m = s.match(/\b(\d{4})\b/);
    if (m) { out.endYear = parseInt(m[1], 10); return out; }

    return out;
  }

  // ---------- Education entry sorting (latest first) ----------
  function rankEducationEntry(entry) {
    if (entry.isPresent) return 9999;
    if (entry.isExpected) return 9998;
    return entry.endYear || 0;
  }

  function pickLatestEntry(entries) {
    if (!entries.length) return null;
    return entries.slice().sort((a, b) => rankEducationEntry(b) - rankEducationEntry(a))[0];
  }

  // ---------- Format Capella education to user-specified string ----------
  // "Capella University, <degree>, <years>"
  function formatCapellaEducation(entry) {
    if (!entry) return '';
    let parts = ['Capella University'];
    if (entry.degree) parts.push(entry.degree);
    let tail = '';
    if (entry.isPresent && entry.startYear) tail = `${entry.startYear} - Present`;
    else if (entry.isExpected && entry.endYear) {
      // Use the raw "Expected ..." form if it exists (preserves month if listed)
      tail = entry.dateRaw && /expected/i.test(entry.dateRaw) ? entry.dateRaw : `Expected ${entry.endYear}`;
    } else if (entry.startYear && entry.endYear) tail = `${entry.startYear} - ${entry.endYear}`;
    else if (entry.endYear) tail = String(entry.endYear);
    else if (entry.startYear) tail = String(entry.startYear);
    if (tail) parts.push(tail);
    return parts.join(', ');
  }

  // ---------- 3-year rule ----------
  function withinThreeYears(entry, currentYear) {
    if (!entry) return false;
    if (entry.isPresent || entry.isExpected) return true;
    if (!entry.endYear) return true; // no end year known → keep
    return (currentYear - entry.endYear) <= 3;
  }

  // ---------- Expose ----------
  window.Cartograph = {
    MSG, STATE,
    sleep, rand, randInt, jitter,
    log, warn, err,
    isLoggedOut, isRateLimited,
    isOnConnectionsPage, isOnCapellaPeoplePage, isOnProfilePage, isOnEducationDetailPage,
    normalizeProfileUrl, getCurrentProfileUrl,
    extractProfileLinks, waitForInitialLinks, humanScroll, scrollIntoView,
    queryAny, queryAllAny,
    findNameElement,
    stripUsaSuffix,
    parseEducationDates, rankEducationEntry, pickLatestEntry, formatCapellaEducation,
    withinThreeYears
  };

  log('utils.js loaded.');
})();
