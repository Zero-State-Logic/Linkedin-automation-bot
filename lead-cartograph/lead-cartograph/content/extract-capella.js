// content/extract-capella.js — collects /in/ links from the Capella alumni page.
// Capella page uses "Show more results" pagination instead of pure infinite scroll.

(function () {
  const C = window.Cartograph;
  const { sleep, jitter, randInt, log, warn, isLoggedOut, isOnCapellaPeoplePage,
          extractProfileLinks, waitForInitialLinks, humanScroll, STATE, MSG } = C;

  async function tryClickShowMore() {
    // The "Show more results" button text varies slightly. Try multiple matches.
    const buttons = Array.from(document.querySelectorAll('button, a'));
    const btn = buttons.find((b) => {
      const t = (b.textContent || '').trim().toLowerCase();
      return t === 'show more results' || t === 'show more' || t.startsWith('show more results');
    });
    if (!btn) return false;
    try {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(jitter(500, 150));
      btn.click();
      await sleep(jitter(2500, 500));
      return true;
    } catch (e) {
      warn('Show-more click failed:', e?.message);
      return false;
    }
  }

  async function extractCapellaLoop({ count, delayMs }) {
    const target = count === 'all' ? Infinity : count;
    const seen = new Set();
    let consecutiveNoNew = 0;
    const MAX_NO_NEW = 4;
    let iter = 0;
    const MAX_ITER = 600;

    if (!(await waitForInitialLinks())) throw new Error('Capella alumni list did not load.');

    while (!STATE.cancelled && seen.size < target && iter < MAX_ITER) {
      iter++;

      // Scroll a few times to load lazy content
      for (let s = 0; s < 3 && !STATE.cancelled; s++) {
        await humanScroll();
        await sleep(jitter(600, 200));
      }

      const current = extractProfileLinks();
      const fresh = current.filter((u) => !seen.has(u));

      if (fresh.length > 0) {
        consecutiveNoNew = 0;
        const allowed = target === Infinity ? fresh : fresh.slice(0, target - seen.size);
        allowed.forEach((u) => seen.add(u));
        try {
          await chrome.runtime.sendMessage({
            type: MSG.LINKS_BATCH,
            context: 'extract_capella_page',
            urls: allowed
          });
        } catch (e) { warn('LINKS_BATCH send failed:', e?.message); }
        try {
          await chrome.runtime.sendMessage({
            type: MSG.TASK_PROGRESS,
            progress: { current: seen.size, target: target === Infinity ? null : target }
          });
        } catch {}
        log(`Iter ${iter}: +${allowed.length} new (total ${seen.size}).`);
      } else {
        consecutiveNoNew++;
        log(`Iter ${iter}: no new (${consecutiveNoNew}/${MAX_NO_NEW}).`);
      }

      if (seen.size >= target || STATE.cancelled) break;

      // Try clicking "Show more results"
      const clicked = await tryClickShowMore();
      if (!clicked && consecutiveNoNew >= MAX_NO_NEW) {
        // One last patient check before declaring end
        await sleep(3000);
        const finalNew = extractProfileLinks().filter((u) => !seen.has(u));
        if (finalNew.length === 0) { log('End of Capella alumni list.'); break; }
        finalNew.forEach((u) => seen.add(u));
        consecutiveNoNew = 0;
      }

      await sleep(jitter(delayMs, delayMs * 0.3));

      if (iter > 0 && iter % randInt(15, 22) === 0 && !STATE.cancelled) {
        const pauseMs = randInt(8000, 14000);
        log(`Long pause: ${pauseMs}ms`);
        await sleep(pauseMs);
      }
    }

    return Array.from(seen);
  }

  C.runExtractCapella = async function (params) {
    if (STATE.running) return { ok: false, error: 'Already running' };
    if (isLoggedOut()) return { ok: false, error: 'Not logged in to LinkedIn' };
    if (!isOnCapellaPeoplePage()) {
      return { ok: false, error: 'Not on the Capella alumni page. Got: ' + window.location.pathname };
    }
    STATE.running = true;
    STATE.cancelled = false;
    try {
      const { count = 500, delayMs = 3500 } = params || {};
      const collected = await extractCapellaLoop({ count, delayMs });
      STATE.running = false;
      return { ok: true, collected: collected.length, cancelled: STATE.cancelled };
    } catch (e) {
      STATE.running = false;
      return { ok: false, error: e.message };
    }
  };

  C.log('extract-capella.js loaded.');
})();
