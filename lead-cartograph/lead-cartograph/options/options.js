import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../lib/constants.js';
import { getAllSettings, setSetting } from '../lib/storage.js';
import { testConnection } from '../lib/api.js';

const els = {
  appsScriptUrl: document.getElementById('apps-script-url'),
  testBtn: document.getElementById('btn-test'),
  connResult: document.getElementById('conn-result'),
  delayMult: document.getElementById('delay-multiplier'),
  delayMultVal: document.getElementById('delay-multiplier-value'),
  maxLinks: document.getElementById('max-links'),
  yearAuto: document.getElementById('year-auto'),
  yearManual: document.getElementById('year-manual'),
  yearStart: document.getElementById('year-start'),
  yearEnd: document.getElementById('year-end'),
  autoHint: document.getElementById('auto-hint'),
  saveBtn: document.getElementById('btn-save'),
  resetBtn: document.getElementById('btn-reset'),
  saveStatus: document.getElementById('save-status')
};

init();

async function init() {
  const settings = await getAllSettings();
  els.appsScriptUrl.value = settings.appsScriptUrl || '';
  els.delayMult.value = settings.delayMultiplier;
  els.delayMultVal.textContent = `${parseFloat(settings.delayMultiplier).toFixed(1)}×`;
  els.maxLinks.value = settings.maxLinksPerSession;

  const y = new Date().getFullYear();
  els.autoHint.textContent = `(${y - 1} – ${y + 1})`;

  if (settings.yearRangeOverride) {
    els.yearManual.checked = true;
    els.yearStart.value = settings.yearRangeOverride.start;
    els.yearEnd.value = settings.yearRangeOverride.end;
    els.yearStart.disabled = false;
    els.yearEnd.disabled = false;
  }

  bindEvents();
}

function bindEvents() {
  els.delayMult.addEventListener('input', () => {
    els.delayMultVal.textContent = `${parseFloat(els.delayMult.value).toFixed(1)}×`;
  });

  document.querySelectorAll('input[name="year-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const manual = els.yearManual.checked;
      els.yearStart.disabled = !manual;
      els.yearEnd.disabled = !manual;
      if (manual && !els.yearStart.value) {
        const y = new Date().getFullYear();
        els.yearStart.value = y - 1;
        els.yearEnd.value = y + 1;
      }
    });
  });

  els.testBtn.addEventListener('click', async () => {
    els.connResult.textContent = 'testing…';
    els.connResult.className = 'conn-result';
    // Persist URL first so the test uses the latest value
    await setSetting(STORAGE_KEYS.APPS_SCRIPT_URL, els.appsScriptUrl.value.trim());
    const result = await testConnection();
    els.connResult.textContent = result.message;
    els.connResult.className = `conn-result ${result.ok ? 'ok' : 'bad'}`;
  });

  els.saveBtn.addEventListener('click', async () => {
    const url = els.appsScriptUrl.value.trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/.*\/exec$/.test(url)) {
      flash('URL should end with /exec — double-check the deployment URL.', false);
      return;
    }
    await setSetting(STORAGE_KEYS.APPS_SCRIPT_URL, url);
    await setSetting(STORAGE_KEYS.DELAY_MULTIPLIER, parseFloat(els.delayMult.value));
    await setSetting(STORAGE_KEYS.MAX_LINKS_PER_SESSION, parseInt(els.maxLinks.value, 10) || 500);

    if (els.yearManual.checked) {
      const start = parseInt(els.yearStart.value, 10);
      const end = parseInt(els.yearEnd.value, 10);
      if (!start || !end || start > end) {
        flash('Year range invalid — start must be ≤ end.', false);
        return;
      }
      await setSetting(STORAGE_KEYS.YEAR_RANGE_OVERRIDE, { start, end });
    } else {
      await setSetting(STORAGE_KEYS.YEAR_RANGE_OVERRIDE, null);
    }
    flash('Settings saved.', true);
  });

  els.resetBtn.addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults? Apps Script URL will be cleared.')) return;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      await setSetting(key, DEFAULT_SETTINGS[key]);
    }
    await setSetting(STORAGE_KEYS.YEAR_RANGE_OVERRIDE, null);
    location.reload();
  });
}

function flash(msg, ok) {
  els.saveStatus.textContent = msg;
  els.saveStatus.className = `save-status ${ok ? 'ok' : 'bad'}`;
  setTimeout(() => {
    els.saveStatus.textContent = '';
    els.saveStatus.className = 'save-status';
  }, 3000);
}
