import { MESSAGES, TASK_TYPES, STORAGE_KEYS } from '../lib/constants.js';
import { getSetting, getLastRun, getCurrentTask } from '../lib/storage.js';

const els = {
  connDot: document.querySelector('#conn-status .dot'),
  connLabel: document.querySelector('#conn-status .conn-label'),
  yearRange: document.getElementById('year-range'),
  statusText: document.getElementById('status-text'),
  lastRun: document.getElementById('last-run'),
  toast: document.getElementById('toast'),
  connCount: document.getElementById('conn-count'),
  connAll: document.getElementById('conn-all'),
  capellaCount: document.getElementById('capella-count'),
  capellaAll: document.getElementById('capella-all'),
  openSettings: document.getElementById('open-settings'),
  openSheet: document.getElementById('open-sheet'),
  cancelBtn: null  // injected lazily
};

let pollHandle = null;

init();

async function init() {
  // Year range hint
  const override = await getSetting(STORAGE_KEYS.YEAR_RANGE_OVERRIDE);
  if (override) {
    els.yearRange.textContent = `${override.start} – ${override.end}`;
  } else {
    const y = new Date().getFullYear();
    els.yearRange.textContent = `${y - 1} – ${y + 1}`;
  }

  injectCancelButton();
  updateConnectionStatus();
  await refreshStatus();
  await refreshLastRun();
  bindActions();

  // Poll while task is running (popup may have been opened mid-task)
  startPollingIfRunning();
}

function injectCancelButton() {
  const statusRow = els.statusText.closest('.status-row');
  if (!statusRow) return;
  const btn = document.createElement('button');
  btn.id = 'cancel-task';
  btn.className = 'cancel-btn';
  btn.textContent = 'Cancel';
  btn.style.display = 'none';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Cancelling…';
    try {
      await chrome.runtime.sendMessage({ type: MESSAGES.CANCEL_TASK });
    } catch (e) { toast(e.message, true); }
  });
  statusRow.appendChild(btn);
  els.cancelBtn = btn;
}

function bindActions() {
  for (const [input, allBtn] of [[els.connCount, els.connAll], [els.capellaCount, els.capellaAll]]) {
    allBtn.addEventListener('click', () => {
      const active = allBtn.classList.toggle('active');
      if (active) {
        input.value = '';
        input.disabled = true;
      } else {
        input.disabled = false;
        input.focus();
      }
    });
    input.addEventListener('input', () => {
      allBtn.classList.remove('active');
      input.disabled = false;
    });
  }

  document.querySelectorAll('[data-task]').forEach((btn) => {
    btn.addEventListener('click', () => handleTaskClick(btn));
  });

  els.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.openSheet.addEventListener('click', async () => {
    const url = await getSetting(STORAGE_KEYS.APPS_SCRIPT_URL);
    if (!url) { toast('Set Apps Script URL in Settings first.', true); return; }
    chrome.tabs.create({ url: 'https://drive.google.com/drive/recent' });
  });
}

async function handleTaskClick(btn) {
  const taskType = btn.dataset.task;
  const params = {};

  if (taskType === TASK_TYPES.EXTRACT_CONNECTIONS) {
    params.count = els.connAll.classList.contains('active')
      ? 'all'
      : (parseInt(els.connCount.value, 10) || 50);
  } else if (taskType === TASK_TYPES.EXTRACT_CAPELLA_PAGE) {
    params.count = els.capellaAll.classList.contains('active')
      ? 'all'
      : (parseInt(els.capellaCount.value, 10) || 500);
  }

  const apps = await getSetting(STORAGE_KEYS.APPS_SCRIPT_URL);
  if (!apps) { toast('Set Apps Script URL in Settings first.', true); return; }

  setTaskButtonsDisabled(true);
  const label = btn.querySelector('.btn-text')?.textContent.trim() || btn.textContent.trim();
  toast(`Starting: ${label}`);

  try {
    const resp = await chrome.runtime.sendMessage({
      type: MESSAGES.START_TASK,
      taskType,
      params
    });
    if (!resp?.ok) {
      toast(resp?.error || 'Failed to start task.', true);
      setTaskButtonsDisabled(false);
      return;
    }
    await refreshStatus();
    startPollingIfRunning();
  } catch (err) {
    toast(err.message, true);
    setTaskButtonsDisabled(false);
  }
}

async function updateConnectionStatus() {
  setDot('unknown', 'checking…');
  const url = await getSetting(STORAGE_KEYS.APPS_SCRIPT_URL);
  if (!url) { setDot('bad', 'not configured'); return; }
  try {
    const resp = await chrome.runtime.sendMessage({ type: MESSAGES.PING_APPS_SCRIPT });
    if (resp?.result?.ok) setDot('ok', 'connected');
    else setDot('bad', 'error');
  } catch { setDot('bad', 'offline'); }
}

function setDot(state, label) {
  els.connDot.classList.remove('dot-ok', 'dot-bad', 'dot-unknown');
  els.connDot.classList.add(`dot-${state}`);
  els.connLabel.textContent = label;
}

async function refreshStatus() {
  const task = await getCurrentTask();
  if (!task || task.status !== 'running') {
    els.statusText.textContent = 'Idle';
    if (els.cancelBtn) els.cancelBtn.style.display = 'none';
    setTaskButtonsDisabled(false);
    stopPolling();
    return;
  }
  const msg = task.message || 'running…';
  els.statusText.textContent = `${task.label} · ${msg}`;
  if (els.cancelBtn) {
    els.cancelBtn.style.display = 'inline-block';
    els.cancelBtn.disabled = false;
    els.cancelBtn.textContent = 'Cancel';
  }
  setTaskButtonsDisabled(true);
}

async function refreshLastRun() {
  const last = await getLastRun();
  if (!last) { els.lastRun.textContent = 'never'; return; }
  const when = new Date(last.timestamp);
  const ago = timeAgo(when);
  const summary = last.addedToSheet !== undefined
    ? `+${last.addedToSheet} · ${last.skipped || 0} dup`
    : '';
  els.lastRun.textContent = `${summary} · ${ago}`;
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function setTaskButtonsDisabled(disabled) {
  document.querySelectorAll('[data-task]').forEach((b) => { b.disabled = disabled; });
}

function toast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', isError);
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function startPollingIfRunning() {
  if (pollHandle) return;
  pollHandle = setInterval(refreshStatus, 1500);
}

function stopPolling() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
}

// Listen for service worker broadcasts
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MESSAGES.TASK_COMPLETE) {
    refreshStatus();
    refreshLastRun();
    const s = msg.summary || {};
    const text = s.cancelled
      ? 'Cancelled.'
      : `Done. Added ${s.added || 0}, skipped ${s.skipped || 0}.`;
    toast(text);
  } else if (msg.type === MESSAGES.TASK_FAILED) {
    refreshStatus();
    refreshLastRun();
    toast(msg.error || 'Task failed.', true);
  } else if (msg.type === MESSAGES.TASK_PROGRESS) {
    refreshStatus();
  }
});
