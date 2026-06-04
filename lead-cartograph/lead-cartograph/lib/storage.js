// Thin wrapper around chrome.storage for typed access and defaults
import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants.js';

const storage = chrome.storage.local;

export async function getSetting(key) {
  const result = await storage.get(key);
  if (key in result) return result[key];
  // Fall back to defaults
  const defaultKey = key in DEFAULT_SETTINGS ? key : null;
  return defaultKey ? DEFAULT_SETTINGS[defaultKey] : null;
}

export async function setSetting(key, value) {
  await storage.set({ [key]: value });
}

export async function getAllSettings() {
  const result = await storage.get(Object.values(STORAGE_KEYS));
  // Merge with defaults
  return { ...DEFAULT_SETTINGS, ...result };
}

export async function getLastRun() {
  const r = await storage.get(STORAGE_KEYS.LAST_RUN);
  return r[STORAGE_KEYS.LAST_RUN] || null;
}

export async function setLastRun(info) {
  await storage.set({ [STORAGE_KEYS.LAST_RUN]: info });
}

export async function getCurrentTask() {
  const r = await storage.get(STORAGE_KEYS.CURRENT_TASK);
  return r[STORAGE_KEYS.CURRENT_TASK] || null;
}

export async function setCurrentTask(task) {
  await storage.set({ [STORAGE_KEYS.CURRENT_TASK]: task });
}

export async function clearCurrentTask() {
  await storage.remove(STORAGE_KEYS.CURRENT_TASK);
}

export async function getSeenUrlsCache() {
  const r = await storage.get([STORAGE_KEYS.SEEN_URLS_CACHE, STORAGE_KEYS.SEEN_URLS_CACHE_AT]);
  return {
    urls: new Set(r[STORAGE_KEYS.SEEN_URLS_CACHE] || []),
    cachedAt: r[STORAGE_KEYS.SEEN_URLS_CACHE_AT] || null
  };
}

export async function setSeenUrlsCache(urls) {
  await storage.set({
    [STORAGE_KEYS.SEEN_URLS_CACHE]: Array.from(urls),
    [STORAGE_KEYS.SEEN_URLS_CACHE_AT]: new Date().toISOString()
  });
}
