// content/extract-connections.js — collects /in/ links from the Connections page.

(function () {
  const C = window.Cartograph;
  const { sleep, jitter, randInt, log, warn, isLoggedOut, isOnConnectionsPage,
          extractProfileLinks, waitForInitialLinks, humanScroll, queryAny, STATE, MSG } = C;

  async function trySetSortRecentlyAdded() {
    try {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const txt = (b.textContent || '').toLowerCase();
        return aria.includes('sort') || txt.includes('sort by');
      });
      if (!btn) return false;

      const currentText = (btn.textContent || '').toLowerCase();
      if (currentText.includes('recently added')) {
        log('Sort already set to Recently added.');
        return true;
      }

      btn.click();
      await sleep(jitter(800, 200));
      const items = document.querySelectorAll(
        '[role="menuitem"], [role="option"], li button, ul li[tabindex]'
      );
      for (const item of items) {
        if ((item.textContent || '').toLowerCase().includes('recently added')) {
          item.click();
          await sleep(jitter(1500, 300));
          log('Set sort to Recently added.');
          return true;
        }
      }
    } catch (err) {
      warn('Could not set sort order:', err.message);
    }
    return false;
  }

  async function extractConnectionsLoop({ count, delayMs }) {
    const target = count === 'all' ? Infinity : count;
    const seen = new Set();
    let consecutiveNoNew = 0;
    const MAX_NO_NEW = 5;
    let iter = 0;
    const MAX_ITER = 500;

    if (!(await waitForInitialLinks())) throw new Error('Connections list did not load.');
    await trySetSortRecentlyAdded();
    await sleep(jitter(1200, 300));

    while (!STATE.cancelled && seen.size < target && iter < MAX_ITER) {
      iter++;
      const current = extractProfileLinks();
      const fresh = current.filter((u) => !seen.has(u));

      if (fresh.length > 0) {
        consecutiveNoNew = 0;
        const allowed = target === Infinity ? fresh : fresh.slice(0, target - seen.size);
        allowed.forEach((u) => seen.add(u));

        try {
          await chrome.runtime.sendMessage({
            type: MSG.LINKS_BATCH,
            context: 'extract_connections',
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
        if (consecutiveNoNew >= MAX_NO_NEW) {
          await sleep(3000);
          const finalNew = extractProfileLinks().filter((u) => !seen.has(u));
          if (finalNew.length === 0) { log('End of list reached.'); break; }
          finalNew.forEach((u) => seen.add(u));
          consecutiveNoNew = 0;
        }
      }

      if (seen.size >= target || STATE.cancelled) break;
      await humanScroll();
      await sleep(jitter(delayMs, delayMs * 0.3));

      if (iter > 0 && iter % randInt(18, 25) === 0 && !STATE.cancelled) {
        const pauseMs = randInt(8000, 16000);
        log(`Long pause: ${pauseMs}ms`);
        await sleep(pauseMs);
      }
    }

    return Array.from(seen);
  }

  C.runExtractConnections = async function (params) {
    if (STATE.running) return { ok: false, error: 'Already running' };
    if (isLoggedOut()) return { ok: false, error: 'Not logged in to LinkedIn' };
    if (!isOnConnectionsPage()) {
      return { ok: false, error: 'Not on the Connections page. Got: ' + window.location.pathname };
    }
    STATE.running = true;
    STATE.cancelled = false;
    try {
      const { count = 50, delayMs = 3000 } = params || {};
      const collected = await extractConnectionsLoop({ count, delayMs });
      STATE.running = false;
      return { ok: true, collected: collected.length, cancelled: STATE.cancelled };
    } catch (e) {
      STATE.running = false;
      return { ok: false, error: e.message };
    }
  };

  C.log('extract-connections.js loaded.');
})();
