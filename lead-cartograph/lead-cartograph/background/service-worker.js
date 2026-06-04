// background/service-worker.js — THIN ROUTER. Entry point for the MV3 service worker.
// All real work lives in orchestrator.js, tasks-extract.js, tasks-collect.js.

import { MESSAGES, TASK_TYPES, TASK_LABELS } from '../lib/constants.js';
import { testConnection } from '../lib/api.js';
import {
  getCurrentTask, setCurrentTask, clearCurrentTask, setLastRun
} from '../lib/storage.js';
import {
  log, warn, err, mergeTask, broadcast, failTask, safeTabSend,
  startKeepAlive, stopKeepAlive
} from './orchestrator.js';
import {
  runExtractConnections, runExtractCapella, handleLinksBatch
} from './tasks-extract.js';
import { runCollectorTask } from './tasks-collect.js';

// ---------- MV3 keep-alive listener ----------
// The alarm itself does nothing, but the EVENT firing keeps the SW from being terminated.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cartograph-keepalive') {
    // No-op — receiving the alarm resets the idle timer
  }
});

// ---------- Lifecycle ----------
chrome.runtime.onInstalled.addListener(({ reason }) => {
  log('Installed:', reason);
});
log('Service worker started.');

// ---------- Message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case MESSAGES.PING_APPS_SCRIPT: {
          const result = await testConnection();
          sendResponse({ ok: true, result });
          return;
        }
        case MESSAGES.GET_TASK_STATUS: {
          sendResponse({ ok: true, task: await getCurrentTask() });
          return;
        }
        case MESSAGES.START_TASK: {
          const r = await startTask(msg.taskType, msg.params || {});
          sendResponse(r);
          return;
        }
        case MESSAGES.CANCEL_TASK: {
          await cancelTask();
          sendResponse({ ok: true });
          return;
        }
        case MESSAGES.LINKS_BATCH: {
          await handleLinksBatch(msg.urls || [], msg.context);
          sendResponse({ ok: true });
          return;
        }
        case MESSAGES.CONTENT_TASK_COMPLETE: {
          await finishCurrentTask({ collected: msg.collected, cancelled: msg.cancelled });
          sendResponse({ ok: true });
          return;
        }
        case MESSAGES.CONTENT_TASK_FAILED: {
          await failTask(msg.error || 'Content script reported failure.');
          sendResponse({ ok: true });
          return;
        }
        case MESSAGES.TASK_PROGRESS: {
          await updateProgress(msg.progress);
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
      }
    } catch (e) {
      err('Message handler error:', e);
      try { sendResponse({ ok: false, error: e.message }); } catch {}
    }
  })();
  return true;
});

// ---------- Task launching ----------
async function startTask(taskType, params) {
  const current = await getCurrentTask();
  if (current && current.status === 'running') {
    return { ok: false, error: 'A task is already running.' };
  }

  const task = {
    id: `task_${Date.now()}`,
    type: taskType,
    label: TASK_LABELS[taskType] || taskType,
    params,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { current: 0, target: params.count ?? null },
    addedToSheet: 0,
    skipped: 0,
    activeTabId: null,
    cancelled: false,
    message: 'Starting…'
  };
  await setCurrentTask(task);

  // Keep the MV3 service worker alive for the duration of the task
  startKeepAlive();

  try {
    switch (taskType) {
      case TASK_TYPES.EXTRACT_CONNECTIONS:
        return await runExtractConnections(task, params);
      case TASK_TYPES.EXTRACT_CAPELLA_PAGE:
        return await runExtractCapella(task, params);
      case TASK_TYPES.COLLECT_ALL:
      case TASK_TYPES.COLLECT_EDUCATION:
      case TASK_TYPES.COLLECT_NAMES:
      case TASK_TYPES.COLLECT_LOCATIONS:
      case TASK_TYPES.COLLECT_CONTACT:
        return await runCollectorTask(task, params);
      default:
        await failTask('Unknown task type: ' + taskType);
        return { ok: false, error: 'Unknown task type' };
    }
  } finally {
    // We don't stopKeepAlive here — the task may still be running async.
    // finishCurrentTask / failTask are the actual completion points.
  }
}

async function cancelTask() {
  const task = await getCurrentTask();
  if (!task) return;
  await mergeTask({ cancelled: true });
  if (task.activeTabId) {
    await safeTabSend(task.activeTabId, { type: MESSAGES.STOP_CONTENT_TASK });
  }
  // Grace period for the content script to wrap up cleanly
  setTimeout(async () => {
    const t = await getCurrentTask();
    if (t && t.id === task.id) {
      await failTask('Cancelled.');
    }
  }, 3000);
}

async function updateProgress(progress) {
  if (!progress) return;
  await mergeTask((t) => ({
    progress,
    message: progress.target
      ? `${progress.current}/${progress.target} collected${t.addedToSheet ? ` · ${t.addedToSheet} added` : ''}`
      : `${progress.current} collected${t.addedToSheet ? ` · ${t.addedToSheet} added` : ''}`
  }));
  broadcast({ type: MESSAGES.TASK_PROGRESS, progress });
}

async function finishCurrentTask({ collected, cancelled }) {
  const task = await getCurrentTask();
  if (!task) return;
  stopKeepAlive();
  await setLastRun({
    type: task.type,
    label: task.label,
    addedToSheet: task.addedToSheet || 0,
    skipped: task.skipped || 0,
    collected: collected ?? 0,
    timestamp: new Date().toISOString(),
    ok: !cancelled,
    cancelled: !!cancelled
  });
  await clearCurrentTask();
  broadcast({
    type: MESSAGES.TASK_COMPLETE,
    summary: { collected, added: task.addedToSheet, skipped: task.skipped, cancelled }
  });
}

// ---------- Tab lifecycle: kill task if user closes/navigates away ----------
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const task = await getCurrentTask();
  if (task && task.activeTabId === tabId) {
    await failTask('LinkedIn tab was closed during the task.');
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const task = await getCurrentTask();
  if (!task || task.activeTabId !== tabId) return;
  if (!changeInfo.url.includes('linkedin.com')) {
    await failTask('You navigated away from LinkedIn during the task.');
  }
});
