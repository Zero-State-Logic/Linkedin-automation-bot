// background/orchestrator.js — shared helpers used by all task implementations.
// Tab management, navigation, content-script handshake, task state, dedup cache.

import { MESSAGES, STORAGE_KEYS } from '../lib/constants.js';
import { getAllProfileUrls } from '../lib/api.js';
import {
  getCurrentTask, setCurrentTask, clearCurrentTask, setLastRun,
  getSeenUrlsCache, setSeenUrlsCache, getSetting
} from '../lib/storage.js';

// ---------- Logging ----------
export function log(...args) { console.log('[Cartograph SW]', ...args); }
export function warn(...args) { console.warn('[Cartograph SW]', ...args); }
export function err(...args) { console.error('[Cartograph SW]', ...args); }

// ---------- Utility ----------
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = (base, spread) => Math.max(100, base + (Math.random() * 2 - 1) * spread);

// ---------- Tab management ----------
export async function openOrFocusTab(url) {
  const baseUrl = url.split('?')[0];
  const matches = await chrome.tabs.query({ url: baseUrl + '*' });
  if (matches.length > 0) {
    const tab = matches[0];
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
    await chrome.tabs.update(tab.id, { active: true });
    return tab;
  }
  return await chrome.tabs.create({ url, active: true });
}

// Navigate an existing tab to a URL and wait for it to fully load.
export async function navigateAndWait(tabId, url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Navigation timeout for ${url}`));
    }, timeoutMs);
    function listener(updatedTabId, info, tab) {
      if (updatedTabId !== tabId) return;
      if (info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve(tab);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((e) => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      reject(e);
    });
  });
}

// Ping the content script until it responds (or timeout).
export async function waitForContentScript(tabId, timeoutMs = 30000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: MESSAGES.CONTENT_PING });
      if (resp?.ok) return true;
    } catch (e) { lastErr = e; }
    await sleep(500);
  }
  throw new Error('Content script did not load in time. ' + (lastErr?.message || ''));
}

// Send a message to a tab, swallow connection errors.
export async function safeTabSend(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (e) {
    warn('tab.sendMessage failed:', e.message);
    return null;
  }
}

// Navigate + wait for page + wait for content script.
export async function gotoAndReady(tabId, url) {
  await navigateAndWait(tabId, url);
  await sleep(600); // brief settle so injection completes
  await waitForContentScript(tabId);
}

// ---------- Task state ----------
export async function mergeTask(updater) {
  const task = await getCurrentTask();
  if (!task) return null;
  const patch = typeof updater === 'function' ? updater(task) : updater;
  const merged = { ...task, ...patch };
  await setCurrentTask(merged);
  return merged;
}

export async function isCurrentTaskCancelled() {
  const t = await getCurrentTask();
  return !t || t.cancelled === true || t.status !== 'running';
}

export function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export async function finishTask({ collected, summary, addedToSheet, skipped } = {}) {
  const task = await getCurrentTask();
  if (!task) return;
  stopKeepAlive();
  await setLastRun({
    type: task.type,
    label: task.label,
    addedToSheet: addedToSheet ?? task.addedToSheet ?? 0,
    skipped: skipped ?? task.skipped ?? 0,
    collected: collected ?? 0,
    timestamp: new Date().toISOString(),
    ok: true,
    summary
  });
  await clearCurrentTask();
  broadcast({ type: MESSAGES.TASK_COMPLETE, summary: { ...summary, collected, added: addedToSheet ?? task.addedToSheet, skipped: skipped ?? task.skipped } });
}

export async function failTask(error) {
  const task = await getCurrentTask();
  if (task) {
    await setLastRun({
      type: task.type,
      label: task.label,
      addedToSheet: task.addedToSheet || 0,
      skipped: task.skipped || 0,
      timestamp: new Date().toISOString(),
      ok: false,
      error
    });
  }
  stopKeepAlive();
  await clearCurrentTask();
  broadcast({ type: MESSAGES.TASK_FAILED, error });
}

// ---------- Apps Script dedup cache ----------
function normalizeForCompare(href) {
  if (!href) return null;
  let u = String(href).trim().toLowerCase();
  u = u.split('?')[0].split('#')[0];
  if (u.endsWith('/')) u = u.slice(0, -1);
  u = u.replace('://linkedin.com', '://www.linkedin.com');
  u = u.replace(/^http:/, 'https:');
  return u;
}

export async function refreshSeenUrlsCache() {
  try {
    const result = await getAllProfileUrls();
    if (!result?.success) return false;
    const urls = new Set();
    (result.urls || []).forEach((u) => {
      const n = normalizeForCompare(u);
      if (n) urls.add(n);
    });
    await setSeenUrlsCache(urls);
    log(`Dedup cache refreshed: ${urls.size} known URLs.`);
    return true;
  } catch (e) {
    warn('refreshSeenUrlsCache failed:', e.message);
    return false;
  }
}

// ---------- Per-profile rate limiter ----------
export async function profileDelay(extraMultiplier = 1.0) {
  const delayMult = parseFloat(await getSetting(STORAGE_KEYS.DELAY_MULTIPLIER)) || 1.0;
  const base = 5000 * delayMult * extraMultiplier;
  const ms = Math.round(base + Math.random() * base * 0.5);
  await sleep(ms);
}

// ---------- MV3 Service Worker keep-alive ----------
// Chrome kills MV3 service workers after ~30s of inactivity. Long-running tasks
// (collecting 20+ profiles) get killed mid-loop. Using chrome.alarms creates real
// events that reset the idle timer — the listener for the alarm lives in service-worker.js.
const KEEPALIVE_ALARM = 'cartograph-keepalive';

export function startKeepAlive() {
  // 0.5 min = 30s, the minimum allowed in unpacked extensions. Fires often enough
  // to keep the SW from being terminated between iterations.
  try {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
    log('Keep-alive alarm started.');
  } catch (e) {
    warn('Failed to start keep-alive alarm:', e.message);
  }
}

export function stopKeepAlive() {
  try {
    chrome.alarms.clear(KEEPALIVE_ALARM);
    log('Keep-alive alarm stopped.');
  } catch {}
}

// ---------- Per-profile timeout wrapper ----------
// If a single profile's processing hangs (modal stuck, navigation never completes, etc.)
// the whole loop dies. This wraps any async function in a hard timeout so we move on.
export function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}
