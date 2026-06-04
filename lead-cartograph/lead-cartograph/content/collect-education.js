// content/collect-education.js — v2: text-based, class-independent extraction.
// LinkedIn obfuscates CSS classes (aaa2a34c-style hashes), so we ignore classes
// entirely and parse the visible TEXT of the Education section.

(function () {
  const C = window.Cartograph;
  const {
    sleep, jitter, log, warn, err, isLoggedOut,
    parseEducationDates, pickLatestEntry, formatCapellaEducation, withinThreeYears
  } = C;

  // ---------- Find the education section ----------
  // On /details/education/  → the whole <main> is education content.
  // On main profile          → find the <h2> labeled "Education".
  function findEducationSection() {
    const path = window.location.pathname || '';

    if (path.includes('/details/education')) {
      const main = document.querySelector('main');
      if (main) {
        log('On /details/education/ — using whole main as section.');
        return main;
      }
    }

    // Find any h2 with text "Education"
    const headers = document.querySelectorAll('main h2, main span, main div[role="heading"]');
    for (const h of headers) {
      const t = (h.textContent || '').trim();
      if (t === 'Education' || /^Education\b/.test(t)) {
        // Walk up to find an enclosing section/container
        let cur = h.closest('section') || h.parentElement;
        // Make sure we got a container with substantial content, not just the header
        if (cur && (cur.innerText || '').length > 50) {
          log('Found Education section via h2.');
          return cur;
        }
        // Try one more level up
        if (cur?.parentElement && (cur.parentElement.innerText || '').length > 100) {
          log('Found Education section via h2 (one level up).');
          return cur.parentElement;
        }
      }
    }

    log('Education section NOT found.');
    return null;
  }

  // ---------- Parse Capella entries from a section by text ----------
  // Strategy: walk through innerText line-by-line. Whenever we find a line
  // that's exactly "Capella University", grab the next several lines as
  // degree + date_raw (skipping known noise).
  function parseCapellaEntries(section) {
    if (!section) return [];

    const rawText = section.innerText || '';
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    log(`Section innerText has ${lines.length} non-empty lines.`);
    if (lines.length < 3) log('Lines:', lines);

    const NOISE_PATTERN = /^(Activities and societies|Grade|Skills?|Show credential|Show all|Show \d+|Issued|Endorse|Endorsements?|See all|Education|Experience|Volunteering|Recommendations|Following|Followers?)\b/i;
    const STAT_PATTERN = /^\d+\s+(skill|connection|reaction|comment|repost|follower)/i;

    const entries = [];

    for (let i = 0; i < lines.length; i++) {
      // Look for a Capella school name line.
      // Also accept "Capella University · School" or similar variants.
      if (!/^Capella University\b/i.test(lines[i])) continue;

      let degree = null;
      let dateRaw = null;

      // Look at the next ~10 lines
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const ln = lines[j];

        // Stop if we hit another school header (a line that doesn't look like degree/date,
        // and matches school-like wording).
        // Heuristic: if line is short, ends with "University", "College", "School", "Institute"
        if (j > i + 1 && /\b(University|College|School|Institute|Academy)\b\s*$/i.test(ln) && ln.length < 80) {
          break;
        }

        // Skip known noise
        if (NOISE_PATTERN.test(ln) || STAT_PATTERN.test(ln)) continue;
        if (ln.length < 2) continue;

        // Is this a date?
        if (/(?:Expected|Issued)\s+\w+\s+\d{4}|(?:\w+\s+)?\d{4}\s*[-–—]\s*(?:Present|(?:\w+\s+)?\d{4})|\b\d{4}\b/i.test(ln) && ln.length < 80) {
          if (!dateRaw) {
            dateRaw = ln;
            // Don't break — degree might come AFTER date in some layouts
            continue;
          }
        }

        // Otherwise treat as degree (first non-school, non-date, non-noise line)
        if (!degree && ln.length < 250 && !/^https?:\/\//.test(ln)) {
          degree = ln;
          continue;
        }

        if (degree && dateRaw) break;
      }

      const dates = parseEducationDates(dateRaw || '');
      const entry = {
        school: 'Capella University',
        degree,
        dateRaw,
        startYear: dates.startYear || null,
        endYear: dates.endYear || null,
        isPresent: !!dates.isPresent,
        isExpected: !!dates.isExpected
      };
      entries.push(entry);
      log(`Found entry: degree="${degree}" dateRaw="${dateRaw}" parsed=${JSON.stringify(dates)}`);
    }

    return entries;
  }

  // ---------- Wait until education content is visible ----------
  async function waitForEducationContent(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const sec = findEducationSection();
      if (sec) {
        const text = sec.innerText || '';
        // Wait for substantial content (avoids capturing skeleton state)
        if (text.length > 100 && /[A-Za-z]{4,}/.test(text)) {
          await sleep(900); // settle for lazy loads
          return true;
        }
      }
      await sleep(350);
    }
    return false;
  }

  // ---------- Click "Show all educations" on main profile if present ----------
  async function tryExpandOnMainProfile() {
    if (window.location.pathname.includes('/details/education')) return false;
    const candidates = Array.from(document.querySelectorAll('a, button'));
    const link = candidates.find((el) => {
      const t = (el.textContent || '').trim();
      return /^Show all \d+\s+educations?$/i.test(t);
    });
    if (!link) return false;
    try {
      link.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(jitter(500, 150));
      link.click();
      await sleep(jitter(2500, 500));
      return true;
    } catch (e) {
      warn('Expand-education click failed:', e?.message);
      return false;
    }
  }

  // ---------- Main entry point ----------
  C.runCollectEducation = async function () {
    if (isLoggedOut()) return { ok: false, error: 'Not logged in' };

    try {
      const ready = await waitForEducationContent();
      if (!ready) {
        log('Education content did not render in time.');
        return {
          ok: true, education: '', isTarget: false, isCapella: false,
          statusReason: 'Education section did not render'
        };
      }

      // If on main profile, expand the "Show all educations" link
      await tryExpandOnMainProfile();
      // Re-find the section after potential expansion
      const section = findEducationSection();
      if (!section) {
        return {
          ok: true, education: '', isTarget: false, isCapella: false,
          statusReason: 'Education section not found'
        };
      }

      log(`Education section text length: ${(section.innerText || '').length}`);
      log(`Section preview (first 400 chars): ${(section.innerText || '').slice(0, 400).replace(/\s+/g, ' ')}`);

      const entries = parseCapellaEntries(section);
      log(`Capella entries parsed: ${entries.length}`);

      if (entries.length === 0) {
        return {
          ok: true, education: '', isTarget: false, isCapella: false,
          statusReason: 'No Capella entry found in section'
        };
      }

      const latest = pickLatestEntry(entries);
      const currentYear = new Date().getFullYear();
      const within = withinThreeYears(latest, currentYear);
      const formatted = formatCapellaEducation(latest);

      log(`Latest Capella entry: ${formatted} | within 3yr: ${within}`);

      if (!within) {
        return {
          ok: true, education: formatted, isTarget: false, isCapella: true,
          statusReason: `Capella found but ended ${latest.endYear} (>3yr)`
        };
      }
      return {
        ok: true, education: formatted, isTarget: true, isCapella: true,
        statusReason: 'Capella + within 3yr'
      };
    } catch (e) {
      err('runCollectEducation failed:', e);
      return { ok: false, error: e.message };
    }
  };

  C.log('collect-education.js (v2 text-based) loaded.');
})();
