// content/collect-location.js — v3: structural — anchor on the "Contact info" link,
// take the first <p> in its container. Handles single-word locations like "Kenya".

(function () {
  const C = window.Cartograph;
  const { log, warn, err, isLoggedOut, isOnProfilePage, sleep, stripUsaSuffix, findNameElement } = C;

  async function waitForTopCard(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (findNameElement()) {
        await sleep(700);
        return true;
      }
      await sleep(300);
    }
    return false;
  }

  // Reject obvious non-locations
  function plausibleLocation(t) {
    if (!t) return false;
    if (t.length < 2 || t.length > 150) return false;
    if (/^\d+$/.test(t)) return false;                          // pure number
    if (/^https?:\/\//i.test(t)) return false;                  // URL
    if (/[@]/.test(t)) return false;                            // email-like
    if (/^Contact info$/i.test(t)) return false;
    if (/^·$/.test(t)) return false;
    if (/\bfollower|connection|mutual|open to work\b/i.test(t)) return false;
    if (/^(1st|2nd|3rd|You)$/i.test(t)) return false;
    return true;
  }

  function extractLocation() {
    // Strategy 1: find the "Contact info" anchor; location is in the same parent container
    const contactLink = Array.from(document.querySelectorAll('main a')).find((a) => {
      return (a.textContent || '').trim().toLowerCase() === 'contact info';
    });

    if (contactLink) {
      log('extractLocation: found Contact info anchor');
      // Walk up from the link, looking for a container that has multiple <p> elements
      let container = contactLink.parentElement;
      for (let depth = 0; depth < 5 && container; depth++) {
        const ps = Array.from(container.querySelectorAll('p'));
        if (ps.length >= 2) {
          for (const p of ps) {
            // Skip the p that contains the Contact info link itself
            if (p.contains(contactLink)) continue;
            const txt = (p.textContent || '').trim().replace(/\s+/g, ' ');
            if (!txt || txt === '·' || txt === '•') continue;
            if (plausibleLocation(txt)) {
              log(`extractLocation: picked "${txt}" from Contact-info container`);
              return stripUsaSuffix(txt);
            }
          }
        }
        container = container.parentElement;
      }
    } else {
      warn('extractLocation: no Contact info anchor found');
    }

    // Strategy 2: scan top card area for a small <p> that looks like a location.
    // (For profiles where the user has no Contact info link exposed.)
    const nameEl = findNameElement();
    if (nameEl) {
      let card = nameEl.parentElement;
      for (let depth = 0; depth < 8 && card; depth++) {
        const text = card.textContent || '';
        if (/·\s*(1st|2nd|3rd|You)\b/.test(text)) {
          // Within this top-card-ish container, scan p's. Skip headline-like ones (long text).
          const ps = Array.from(card.querySelectorAll('p'));
          for (const p of ps) {
            const txt = (p.textContent || '').trim().replace(/\s+/g, ' ');
            if (!txt || !plausibleLocation(txt)) continue;
            if (txt.length > 100) continue; // headline is usually longer than location
            // Locations often contain a comma or are well-known short geographic names
            if (txt.includes(',') ||
                /\b(Area|Metro|Region|United\s+States|Canada|Kingdom|Australia|India|Kenya|Nigeria|Pakistan|Philippines|Singapore|Brazil|Mexico|Germany|France|Spain|Italy|Japan|China|Korea)\b/i.test(txt)) {
              log(`extractLocation: picked "${txt}" from top-card scan`);
              return stripUsaSuffix(txt);
            }
          }
          break;
        }
        card = card.parentElement;
      }
    }

    warn('extractLocation: no location found');
    return '';
  }

  C.runCollectLocation = async function () {
    log('runCollectLocation starting on', window.location.pathname);
    if (isLoggedOut()) return { ok: false, error: 'Not logged in' };
    if (!isOnProfilePage()) {
      return { ok: false, error: 'Not on a profile page: ' + window.location.pathname };
    }
    try {
      const ready = await waitForTopCard();
      if (!ready) {
        warn('Top card did not render in 12s');
        return { ok: true, location: '', warning: 'Top card did not render' };
      }
      const location = extractLocation();
      log(`RESULT — location: "${location}"`);
      return { ok: true, location };
    } catch (e) {
      err('runCollectLocation failed:', e);
      return { ok: false, error: e.message };
    }
  };

  C.log('collect-location.js (v3 anchor-based) loaded.');
})();
