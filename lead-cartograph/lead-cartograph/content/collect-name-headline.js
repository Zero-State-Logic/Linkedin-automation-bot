// content/collect-name-headline.js — v3: handles h2 (current LinkedIn) and h1 (legacy).
// Headline = first <p> after the connection-degree paragraphs (position-based, class-agnostic).

(function () {
  const C = window.Cartograph;
  const { log, warn, err, isLoggedOut, isOnProfilePage, sleep, findNameElement } = C;

  async function waitForProfileTopCard(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const nameEl = findNameElement();
      if (nameEl && (nameEl.textContent || '').trim().length > 1) {
        await sleep(700); // settle for headline/location lazy render
        return true;
      }
      await sleep(300);
    }
    return false;
  }

  function extractName() {
    const nameEl = findNameElement();
    if (!nameEl) { warn('extractName: no name element found'); return ''; }
    let txt = (nameEl.textContent || '').trim().replace(/\s+/g, ' ');
    // Strip trailing connection degree markers (· 1st / · You)
    txt = txt.split(/[·•|]/)[0].trim();
    if (txt.length > 100) return '';
    return txt;
  }

  // The headline is the first <p> in the top-card content that:
  //  - comes after the connection-degree paragraphs (· 1st / · 2nd / You)
  //  - isn't an obvious noise pattern (Contact info, follower counts, etc.)
  // The degree text often lives in an inner container while the headline lives one
  // level up — so we keep walking up if we don't find a headline at the current level.
  function extractHeadline() {
    const nameEl = findNameElement();
    if (!nameEl) { warn('extractHeadline: no name element'); return ''; }

    function isPlausibleHeadline(txt) {
      if (!txt) return false;
      if (txt === '·' || txt === '•') return false;
      if (/^Contact info$/i.test(txt)) return false;
      if (/^(Open to work|Show details)$/i.test(txt)) return false;
      if (/^·?\s*(1st|2nd|3rd|You)\s*$/i.test(txt)) return false;
      if (/\b\d+\s+(follower|connection|mutual)/i.test(txt)) return false;
      if (/is a mutual connection/i.test(txt)) return false;
      if (txt.length < 3 || txt.length > 400) return false;
      return true;
    }

    let container = nameEl.parentElement;
    for (let depth = 0; depth < 10 && container; depth++) {
      const text = container.textContent || '';
      // Only consider ancestors that contain the degree text — that bounds us within the top card
      if (!/·\s*(1st|2nd|3rd|You)\b/.test(text)) {
        container = container.parentElement;
        continue;
      }
      const ps = Array.from(container.querySelectorAll('p'));
      // Find the LAST p that is a connection-degree marker
      let lastDegreeIdx = -1;
      for (let i = 0; i < ps.length; i++) {
        const t = (ps[i].textContent || '').trim();
        if (/^·?\s*(1st|2nd|3rd|You)\s*$/i.test(t)) lastDegreeIdx = i;
      }
      // First plausible p after the last degree p is the headline
      for (let i = lastDegreeIdx + 1; i < ps.length; i++) {
        const txt = (ps[i].textContent || '').trim().replace(/\s+/g, ' ');
        if (isPlausibleHeadline(txt)) {
          log(`extractHeadline: found at depth ${depth}, p index ${i}: "${txt}"`);
          return txt;
        }
      }
      // No headline in this container — go up another level (the headline likely lives in the parent)
      container = container.parentElement;
    }
    warn('extractHeadline: no headline found after 10 levels');
    return '';
  }

  C.runCollectNameHeadline = async function () {
    log('runCollectNameHeadline starting on', window.location.pathname);
    if (isLoggedOut()) return { ok: false, error: 'Not logged in' };
    if (!isOnProfilePage()) {
      return { ok: false, error: 'Not on a profile page: ' + window.location.pathname };
    }
    try {
      const ready = await waitForProfileTopCard();
      if (!ready) {
        warn('Top card did not render in 12s');
        return { ok: true, name: '', headline: '', warning: 'Top card did not render' };
      }
      const name = extractName();
      const headline = extractHeadline();
      log(`RESULT — name: "${name}" | headline: "${headline}"`);
      return { ok: true, name, headline };
    } catch (e) {
      err('runCollectNameHeadline failed:', e);
      return { ok: false, error: e.message };
    }
  };

  C.log('collect-name-headline.js (v3 h2-aware) loaded.');
})();
