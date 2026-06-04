// content/collect-contact.js — v3: poll for mailto/tel links after clicking Contact info.
// Whether the click opens a modal in-place OR navigates to /overlay/contact-info/,
// the mailto: link will eventually appear in the DOM. We just poll for it.

(function () {
  const C = window.Cartograph;
  const { log, warn, err, sleep, jitter, isLoggedOut, isOnProfilePage, scrollIntoView } = C;

  async function findContactInfoButton() {
    // PRIMARY: text match (current LinkedIn uses href="#" with JS click handler)
    const all = Array.from(document.querySelectorAll('main a, main button'));
    let el = all.find((b) => (b.textContent || '').trim().toLowerCase() === 'contact info');
    if (el) { log('Found contact button by text match.'); return el; }
    // Fallback: href contains overlay/contact-info (legacy)
    el = document.querySelector('a[href*="overlay/contact-info"]');
    if (el) { log('Found contact button by href.'); return el; }
    // Fallback: id contains "contact-info"
    el = document.querySelector('a[id*="contact-info"], button[id*="contact-info"]');
    if (el) { log('Found contact button by id.'); return el; }
    return null;
  }

  // Get all mailto/tel hrefs currently in the document
  function snapshotContacts() {
    const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.href);
    const tels = Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) => a.href);
    return { mailtos, tels };
  }

  // Poll up to timeoutMs for ANY mailto/tel to appear (relative to the baseline snapshot)
  async function pollForContactLinks(baseline, timeoutMs = 9000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = snapshotContacts();
      // Either a NEW link appeared, OR there's any mailto at all (in case baseline missed it)
      const newMailto = current.mailtos.find((h) => !baseline.mailtos.includes(h));
      const newTel = current.tels.find((h) => !baseline.tels.includes(h));
      if (newMailto || current.mailtos.length > baseline.mailtos.length || newTel || current.tels.length > baseline.tels.length) {
        // Wait a bit more in case more links are still appearing
        await sleep(500);
        return snapshotContacts();
      }
      await sleep(300);
    }
    return null;
  }

  // Sometimes phone shows as text under a "Phone" label rather than as a tel: link
  function scrapePhoneFromText() {
    const allText = (document.querySelector('main') || document.body).innerText || '';
    const lines = allText.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (/^Phone\b/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const t = lines[j].replace(/\(.*?\)\s*$/, '').trim(); // strip "(Mobile)" trailer
          if (/^[+\d][\d\s().+\-]{6,}$/.test(t)) return t;
        }
      }
    }
    return '';
  }

  async function tryCloseModal() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      }));
      await sleep(300);
      const closeBtn = document.querySelector(
        'div[role="dialog"] button[aria-label*="dismiss" i], ' +
        'div[role="dialog"] button[aria-label*="close" i]'
      );
      if (closeBtn) { closeBtn.click(); await sleep(300); }
    } catch (e) { /* swallow */ }
  }

  C.runCollectContact = async function () {
    log('runCollectContact starting on', window.location.pathname);
    if (isLoggedOut()) return { ok: false, error: 'Not logged in' };
    if (!isOnProfilePage()) {
      return { ok: false, error: 'Not on a profile page: ' + window.location.pathname };
    }
    try {
      const btn = await findContactInfoButton();
      if (!btn) {
        log('No Contact info button — profile has no public contact info.');
        return { ok: true, email: '', phone: '', warning: 'no contact info button' };
      }

      const baseline = snapshotContacts();
      log(`Baseline: ${baseline.mailtos.length} mailto, ${baseline.tels.length} tel`);

      await scrollIntoView(btn);
      await sleep(jitter(400, 150));
      log('Clicking Contact info...');
      btn.click();

      const result = await pollForContactLinks(baseline, 9000);
      if (!result) {
        warn('No mailto/tel link appeared after click (within 9s)');
        await tryCloseModal();
        return { ok: true, email: '', phone: '', warning: 'no contact links after click' };
      }

      let email = '';
      if (result.mailtos.length > 0) {
        email = result.mailtos[0].replace(/^mailto:/, '').split('?')[0].trim();
      }
      let phone = '';
      if (result.tels.length > 0) {
        phone = result.tels[0].replace(/^tel:/, '').trim();
      } else {
        phone = scrapePhoneFromText();
      }
      log(`RESULT — email: "${email}" | phone: "${phone}"`);

      await tryCloseModal();
      return { ok: true, email, phone };
    } catch (e) {
      err('runCollectContact failed:', e);
      try { await tryCloseModal(); } catch {}
      return { ok: false, error: e.message };
    }
  };

  C.log('collect-contact.js (v3 poll-based) loaded.');
})();
