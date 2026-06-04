// Apps Script API wrapper
// All backend calls go through this module for consistency
import { getSetting } from './storage.js';
import { STORAGE_KEYS } from './constants.js';

async function getEndpoint() {
  const url = await getSetting(STORAGE_KEYS.APPS_SCRIPT_URL);
  if (!url) throw new Error('Apps Script URL not configured. Open Settings.');
  return url;
}

async function post(action, payload = {}) {
  const endpoint = await getEndpoint();
  const body = JSON.stringify({ action, ...payload });
  // Apps Script web apps require special handling: text/plain avoids CORS preflight
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

async function get(action, params = {}) {
  const endpoint = await getEndpoint();
  const qs = new URLSearchParams({ action, ...params }).toString();
  const resp = await fetch(`${endpoint}?${qs}`, { method: 'GET' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

// ---------- Public API ----------
export async function ping() {
  return get('ping');
}

export async function addRow(rowData) {
  return post('addRow', rowData);
}

export async function bulkAdd(rows) {
  return post('bulkAdd', { rows });
}

export async function updateRow(profileUrl, fields, force = false) {
  return post('updateRow', { profileUrl, fields, force });
}

export async function markStatus(profileUrl, status) {
  return post('markStatus', { profileUrl, status });
}

export async function getAllProfileUrls() {
  return get('getAllProfileUrls');
}

export async function getPendingRows(field = 'all') {
  return get('getPendingRows', { field });
}

// Connectivity check that doesn't throw - returns { ok, message }
export async function testConnection() {
  try {
    const result = await ping();
    if (result?.success) return { ok: true, message: 'Connected to Apps Script' };
    return { ok: false, message: result?.error || 'Unexpected response' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
