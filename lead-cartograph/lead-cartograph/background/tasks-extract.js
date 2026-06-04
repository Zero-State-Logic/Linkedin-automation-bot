// background/tasks-extract.js — Extract Links tasks (Connections, Capella alumni).

import { MESSAGES, STORAGE_KEYS, STATUS, LINKEDIN, buildCapellaUrl } from '../lib/constants.js';
import { bulkAdd } from '../lib/api.js';
import { getCurrentTask, getSetting, getSeenUrlsCache, setSeenUrlsCache } from '../lib/storage.js';
import {
  log, warn, err, openOrFocusTab, safeTabSend, waitForContentScript,
  mergeTask, broadcast, refreshSeenUrlsCache, failTask
} from './orchestrator.js';

// ---------- Shared: handle a LINKS_BATCH from content script ----------
export async function handleLinksBatch(urls /* string[] */, context) {
  if (!urls || !urls.length) return;
  const { urls: seen } = await getSeenUrlsCache();
  const newUrls = urls.filter((u) => !seen.has(u));
  const localDups = urls.length - newUrls.length;

  if (newUrls.length === 0) {
    await mergeTask((t) => ({ skipped: (t.skipped || 0) + localDups }));
    return;
  }

  newUrls.forEach((u) => seen.add(u));
  await setSeenUrlsCache(seen);

  try {
    const payload = newUrls.map((u) => ({ profileUrl: u, status: STATUS.PENDING }));
    const result = await bulkAdd(payload);
    const added = result?.added || 0;
    const sheetSkipped = result?.skipped || 0;
    await mergeTask((t) => ({
      addedToSheet: (t.addedToSheet || 0) + added,
      skipped: (t.skipped || 0) + sheetSkipped + localDups,
      message: `${(t.addedToSheet || 0) + added} added · ${(t.skipped || 0) + sheetSkipped + localDups} skipped`
    }));
    broadcast({ type: MESSAGES.TASK_PROGRESS, progress: (await getCurrentTask())?.progress });
  } catch (e) {
    err('bulkAdd failed:', e);
    await mergeTask({ message: `Sheet sync failed: ${(e.message || '').slice(0, 60)}` });
  }
}

// ---------- Extract: My Connections ----------
export async function runExtractConnections(task, params) {
  try {
    await mergeTask({ message: 'Opening LinkedIn tab…' });
    const tab = await openOrFocusTab(LINKEDIN.CONNECTIONS_URL);
    await mergeTask({ activeTabId: tab.id, message: 'Waiting for page…' });
    await waitForContentScript(tab.id);

    const loginCheck = await safeTabSend(tab.id, { type: MESSAGES.CHECK_LOGIN });
    if (!loginCheck?.loggedIn) throw new Error('Not logged in to LinkedIn. Log in and try again.');

    await mergeTask({ message: 'Loading existing leads for dedup…' });
    await refreshSeenUrlsCache();

    const delayMult = parseFloat(await getSetting(STORAGE_KEYS.DELAY_MULTIPLIER)) || 1.0;
    const baseDelay = Math.round(3000 * delayMult);
    const maxLinks = parseInt(await getSetting(STORAGE_KEYS.MAX_LINKS_PER_SESSION), 10) || 500;

    let count = params.count;
    if (count !== 'all') count = Math.min(parseInt(count, 10) || 50, maxLinks);

    await mergeTask({ message: 'Extracting…' });
    const trigger = await safeTabSend(tab.id, {
      type: MESSAGES.EXTRACT_CONNECTIONS,
      params: { count, delayMs: baseDelay }
    });
    if (!trigger?.ok) throw new Error(trigger?.error || 'Content script refused to start.');
    return { ok: true, task: await getCurrentTask() };
  } catch (e) {
    await failTask(e.message);
    return { ok: false, error: e.message };
  }
}

// ---------- Extract: Capella Alumni Page ----------
export async function runExtractCapella(task, params) {
  try {
    // Resolve year range
    const override = await getSetting(STORAGE_KEYS.YEAR_RANGE_OVERRIDE);
    const url = override
      ? buildCapellaUrl(override.start, override.end)
      : buildCapellaUrl();

    await mergeTask({ message: 'Opening Capella alumni page…' });
    const tab = await openOrFocusTab(url);
    await mergeTask({ activeTabId: tab.id, message: 'Waiting for page…' });
    await waitForContentScript(tab.id);

    const loginCheck = await safeTabSend(tab.id, { type: MESSAGES.CHECK_LOGIN });
    if (!loginCheck?.loggedIn) throw new Error('Not logged in to LinkedIn. Log in and try again.');

    await mergeTask({ message: 'Loading existing leads for dedup…' });
    await refreshSeenUrlsCache();

    const delayMult = parseFloat(await getSetting(STORAGE_KEYS.DELAY_MULTIPLIER)) || 1.0;
    const baseDelay = Math.round(3500 * delayMult);
    const maxLinks = parseInt(await getSetting(STORAGE_KEYS.MAX_LINKS_PER_SESSION), 10) || 500;

    let count = params.count;
    if (count !== 'all') count = Math.min(parseInt(count, 10) || 500, maxLinks);

    await mergeTask({ message: 'Extracting…' });
    const trigger = await safeTabSend(tab.id, {
      type: MESSAGES.EXTRACT_CAPELLA_PAGE_LINKS,
      params: { count, delayMs: baseDelay }
    });
    if (!trigger?.ok) throw new Error(trigger?.error || 'Content script refused to start.');
    return { ok: true, task: await getCurrentTask() };
  } catch (e) {
    await failTask(e.message);
    return { ok: false, error: e.message };
  }
}
