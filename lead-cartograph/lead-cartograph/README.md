# Lead Cartograph

Chrome extension for collecting Capella University student data from LinkedIn into a Google Sheet.

**Version 0.3.0 — full feature set.** Everything is wired up. Time to test end-to-end.

---

## Loading the extension

If this is your first time:
1. Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. **Load unpacked** → select the `lead-cartograph` folder
4. Pin the icon to your toolbar
5. Click the icon → **Settings** → paste your Apps Script URL → **Test Connection** → **Save Settings**

If you already loaded a previous version: go to `chrome://extensions`, find Lead Cartograph, click the **reload icon**. Saved settings persist.

---

## What's built

### Extract Links

- **My Connections** — opens your connections page, scrolls, collects new profile URLs into the sheet
- **Capella Alumni Page** — opens the Capella alumni search page with auto-computed year range (current year ± 1), scrolls + clicks "Show more results", collects URLs

Both dedupe against (a) the extension's local cache and (b) the existing rows in your sheet. New rows go in with `Status = pending`.

### Collect Data

Each collector reads rows from your sheet that have empty cells for its target field, then visits those profiles one by one. The Apps Script's `updateRow` only writes to empty cells, so existing data is never overwritten.

- **Education** — navigates to `https://www.linkedin.com/in/{slug}/details/education/` for each profile with empty Education. Parses every education card, filters for Capella entries, picks the latest by end year, applies the 3-year rule. Writes formatted output: `"Capella University, <degree>, <years>"`. If Capella isn't found or the latest entry ended >3 years ago, marks Status = `rejected`.
- **Names** — visits the main profile, extracts Name and Headline (bundled — they're side-by-side).
- **Locations** — visits the main profile, extracts Location, strips `, USA` / `, United States` suffix.
- **Contact Info** — visits the main profile, clicks the Contact info button, parses email and phone from the modal, closes the modal cleanly.
- **Run ALL** — visits each profile that has any empty field. Runs the education check first (and marks rejected if it fails), then visits the main profile and runs name+headline+location+contact regardless. Final Status = `collected` (all three of: name, contact info, education present) / `partial` (some missing) / `rejected` (Capella check failed).

### Behavior & safety

- **Delays:** randomized 3-5s within a profile, 5-10s between profiles, all multiplied by your delay-multiplier setting.
- **Anti-detection scrolling:** 70-115% of viewport, occasional small 15% bumps, smooth-scroll animation, jitter on every wait, 8-16s pauses every ~20 iterations during extraction.
- **Max-links cap:** safety ceiling (default 500). Even "All" is capped.
- **Cancel button:** visible in the popup footer while a task runs. Stops cleanly at the next iteration boundary.
- **Auto-fail triggers:** tab closed, navigated off LinkedIn, login lost, content script unresponsive after 30s.

---

## File structure

```
lead-cartograph/
├── manifest.json
├── popup/                          UI shown when you click the icon
│   ├── popup.html, popup.css, popup.js
├── options/                        Settings page
│   ├── options.html, options.css, options.js
├── background/                     Service worker (orchestrator)
│   ├── service-worker.js           Entry point + message router
│   ├── orchestrator.js             Tab mgmt, task state, navigation helpers
│   ├── tasks-extract.js            Connections + Capella alumni extraction
│   └── tasks-collect.js            Education/Names/Locations/Contact/ALL
├── content/                        Runs inside LinkedIn pages
│   ├── utils.js                    Loaded first — sets up window.Cartograph
│   ├── extract-connections.js
│   ├── extract-capella.js
│   ├── collect-education.js        ★ The critical one (Capella rules)
│   ├── collect-name-headline.js
│   ├── collect-location.js
│   ├── collect-contact.js
│   └── content.js                  Loaded last — thin message router
├── lib/                            Shared modules
│   ├── constants.js                Message types, task types, URLs
│   ├── storage.js                  chrome.storage wrapper
│   └── api.js                      Apps Script HTTP wrapper
└── icons/
```

The content scripts are split across multiple files for editability, but Chrome loads them in one isolated world — they share a `window.Cartograph` namespace.

---

## Testing flow

**Don't run everything at once.** Test each piece, fix what breaks, then move on.

### 1. Smoke test (5 minutes)
Set delay multiplier to **1.5×**.
- Click **Connections** with count = `10`. Should add ~10 rows with `Status = pending`. If duplicates skipped, expect "Added 7, skipped 3."
- After it finishes, click **Names**. It should walk through each pending row and fill the Name + Headline columns.
- Then **Locations** → fills Location.
- Then **Education** → navigates `/details/education/`, parses Capella entries, fills Education + marks Status = `rejected` for non-Capella profiles (this is expected for non-target connections in your network).

### 2. Education focus (15 minutes)
The hardest part. Test on a handful of profiles that you KNOW are Capella students.
- Mark Education column blank for a few rows you suspect have Capella entries.
- Click **Education**. Open the LinkedIn tab during the run — watch it navigate to each `/details/education/` page.
- Check the result in the sheet: is the format `"Capella University, <degree>, <years>"`?
- Compare with what's actually on the LinkedIn profile.
- Report back: false negatives (real Capella missed), false positives (non-Capella accepted), format issues.

### 3. ALL collector (test sparingly)
This is the big one. **Start with `Max links per session = 5`** in settings so you can test cheaply.
- Click **Run ALL**.
- It should walk through 5 profiles, each taking ~25-30 seconds total.
- Check the sheet: each row should have all fields filled if available, and a final Status.

---

## Debugging

**Service worker logs:** `chrome://extensions` → Lead Cartograph → click the `service worker` link. DevTools opens. Logs prefixed `[Cartograph SW]`.

**Content script logs:** open DevTools on any LinkedIn tab during a run. Logs prefixed `[Cartograph]`. Each script announces itself on load (e.g. `[Cartograph] collect-education.js loaded.`).

**Manifest errors:** `chrome://extensions` → Lead Cartograph → "Errors" link if present.

**Common issues:**
- *Connection dot is red:* Apps Script URL not saved or deployment changed. Re-test in Settings.
- *Content script did not load:* LinkedIn redirected to login/checkpoint. Solve the prompt in the tab, click the extension button again.
- *Task stuck on "Waiting for page…":* the new tab opened but content script didn't register — usually means LinkedIn's CSP blocked us. Refresh and retry.
- *All collectors report 0 rows to process:* your sheet has no rows where that field is empty. Add some rows first via Extract.

---

## What's NOT in this version

- Vision-based fallback (Gemini) when DOM scraping fails — placeholder hooks exist but no code yet. Add later if real-world failure rate is high enough to justify.
- Friend-request sending — separate extension per your spec.
- Mouse-movement simulation — current scroll-based human-likeness is the limit.
- Multi-profile parallelism — we go one profile at a time deliberately (lower detection risk).

---

## Build out next

Once you find issues, paste them with logs and we'll fix one at a time. The most likely places for breakage are the LinkedIn selectors in `content/collect-*.js` — LinkedIn changes those occasionally, and your network's profiles may have edge layouts I haven't seen.
