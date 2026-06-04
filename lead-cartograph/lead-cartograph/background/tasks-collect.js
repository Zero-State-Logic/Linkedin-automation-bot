// background/tasks-collect.js — Per-profile data collection tasks.
// Implements: Collect Education, Names, Locations, Contact info, and ALL.

import { MESSAGES, STORAGE_KEYS, STATUS, TASK_TYPES } from '../lib/constants.js';
import { getPendingRows, updateRow, markStatus } from '../lib/api.js';
import { getCurrentTask, getSetting } from '../lib/storage.js';
import {
  log, warn, err, sleep, jitter, openOrFocusTab, safeTabSend, gotoAndReady,
  mergeTask, broadcast, finishTask, failTask, profileDelay, isCurrentTaskCancelled,
  withTimeout
} from './orchestrator.js';

// Hard cap on how long one profile is allowed to take. If a navigation or modal
// hangs, this fires and we move on to the next profile instead of stalling forever.
const PER_PROFILE_TIMEOUT_MS = 90000;

// ---------- Mapping: TASK_TYPE → which Apps-Script field filter + which content actions ----------
function planForTaskType(taskType) {
  switch (taskType) {
    case TASK_TYPES.COLLECT_EDUCATION:
      return {
        fieldFilter: 'education',
        actions: ['education'],
        isAll: false
      };
    case TASK_TYPES.COLLECT_NAMES:
      return {
        fieldFilter: 'name',
        actions: ['name_headline'],
        isAll: false
      };
    case TASK_TYPES.COLLECT_LOCATIONS:
      return {
        fieldFilter: 'location',
        actions: ['location'],
        isAll: false
      };
    case TASK_TYPES.COLLECT_CONTACT:
      return {
        fieldFilter: 'email',
        actions: ['contact'],
        isAll: false
      };
    case TASK_TYPES.COLLECT_ALL:
      return {
        fieldFilter: 'all',
        actions: ['education', 'name_headline', 'location', 'contact'],
        isAll: true
      };
    default:
      return null;
  }
}

// ---------- Visit one profile and run requested actions ----------
async function processOneProfile(tabId, profileUrl, actions, isAll) {
  const result = {};
  const baseUrl = profileUrl.replace(/\/$/, '');

  // --- Education first (separate page) ---
  if (actions.includes('education')) {
    const eduUrl = baseUrl + '/details/education/';
    log(`→ ${eduUrl}`);
    try {
      await gotoAndReady(tabId, eduUrl);
      const r = await safeTabSend(tabId, { type: MESSAGES.COLLECT_EDUCATION });
      if (r?.ok) {
        result.education = r.education || '';
        result._eduIsTarget = r.isTarget;
        result._eduIsCapella = r.isCapella;
        result._eduStatusReason = r.statusReason;
        log(`Education: "${result.education}" (target=${r.isTarget}, capella=${r.isCapella})`);
        // Both ALL and standalone Education task should mark rejected if check failed
        if (r.isCapella === false || r.isTarget === false) {
          result.status = STATUS.REJECTED;
        }
      } else {
        warn('Education collect failed:', r?.error);
      }
    } catch (e) {
      warn('Education navigation failed:', e.message);
    }
    await sleep(jitter(2500, 700));
  }

  // --- Main profile (name + headline + location + contact) ---
  const mainActions = ['name_headline', 'location', 'contact'].filter((a) => actions.includes(a));
  if (mainActions.length > 0) {
    log(`→ ${baseUrl}`);
    try {
      await gotoAndReady(tabId, baseUrl);
    } catch (e) {
      warn('Main profile navigation failed:', e.message);
      return result;
    }

    for (const action of mainActions) {
      if (await isCurrentTaskCancelled()) break;
      try {
        if (action === 'name_headline') {
          const r = await safeTabSend(tabId, { type: MESSAGES.COLLECT_NAME_HEADLINE });
          if (r?.ok) {
            if (r.name) result.name = r.name;
            if (r.headline) result.headline = r.headline;
          }
        } else if (action === 'location') {
          const r = await safeTabSend(tabId, { type: MESSAGES.COLLECT_LOCATION });
          if (r?.ok && r.location) result.location = r.location;
        } else if (action === 'contact') {
          const r = await safeTabSend(tabId, { type: MESSAGES.COLLECT_CONTACT });
          if (r?.ok) {
            if (r.email) result.email = r.email;
            if (r.phone) result.phone = r.phone;
          }
        }
      } catch (e) {
        warn(`Action ${action} failed:`, e.message);
      }
      await sleep(jitter(1200, 400));
    }
  }

  // --- Final status for ALL collector ---
  if (isAll && result.status !== STATUS.REJECTED) {
    const haveCore = !!result.name;
    const haveContact = !!(result.email || result.phone);
    const haveEdu = !!result.education;
    if (haveCore && haveContact && haveEdu) {
      result.status = STATUS.COLLECTED;
    } else if (haveCore) {
      result.status = STATUS.PARTIAL;
    } else {
      result.status = STATUS.PARTIAL;
    }
  }

  return result;
}

// ---------- Main task orchestrator ----------
export async function runCollectorTask(task, params) {
  const plan = planForTaskType(task.type);
  if (!plan) {
    await failTask('No plan for task type: ' + task.type);
    return { ok: false, error: 'Unknown task type' };
  }

  try {
    await mergeTask({ message: 'Fetching rows from sheet…' });
    const resp = await getPendingRows(plan.fieldFilter);
    if (!resp?.success) throw new Error('Could not fetch pending rows: ' + (resp?.error || 'unknown'));
    let rows = resp.rows || [];

    if (rows.length === 0) {
      await mergeTask({ message: 'Nothing to do — all matching cells already filled.' });
      await finishTask({ collected: 0, summary: { message: 'No pending rows' } });
      return { ok: true };
    }

    const maxLinks = parseInt(await getSetting(STORAGE_KEYS.MAX_LINKS_PER_SESSION), 10) || 500;
    if (rows.length > maxLinks) {
      log(`Capping ${rows.length} rows down to ${maxLinks} (max-links setting).`);
      rows = rows.slice(0, maxLinks);
    }

    await mergeTask({
      message: `Processing ${rows.length} profiles…`,
      progress: { current: 0, target: rows.length }
    });

    // Open a tab; first one goes to feed (safe page) then we drive it from there.
    const tab = await openOrFocusTab('https://www.linkedin.com/feed/');
    await mergeTask({ activeTabId: tab.id });

    let added = 0;
    let rejected = 0;
    let partial = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
      if (await isCurrentTaskCancelled()) { log('Task cancelled.'); break; }
      const row = rows[i];

      log(`[${i + 1}/${rows.length}] Processing ${row.profileUrl}`);
      let processed = false;
      try {
        const result = await withTimeout(
          processOneProfile(tab.id, row.profileUrl, plan.actions, plan.isAll),
          PER_PROFILE_TIMEOUT_MS,
          `Profile ${row.profileUrl}`
        );

        // Update sheet — only fill empty cells (server-side default)
        const updateFields = {};
        ['name', 'headline', 'location', 'email', 'phone', 'education'].forEach((k) => {
          if (result[k] !== undefined && result[k] !== null && result[k] !== '') {
            updateFields[k] = result[k];
          }
        });

        if (Object.keys(updateFields).length > 0) {
          await updateRow(row.profileUrl, updateFields);
          processed = true;
        }

        if (result.status) {
          await markStatus(row.profileUrl, result.status);
          if (result.status === STATUS.REJECTED) rejected++;
          else if (result.status === STATUS.PARTIAL) partial++;
          else if (result.status === STATUS.COLLECTED) added++;
        } else if (processed) {
          added++;
        }
      } catch (e) {
        err('Profile failed:', row.profileUrl, e);
        errors++;
      }

      await mergeTask({
        progress: { current: i + 1, target: rows.length },
        addedToSheet: added,
        skipped: rejected + errors,
        message: `${i + 1}/${rows.length} · added ${added} · rejected ${rejected} · partial ${partial}`
      });
      broadcast({ type: MESSAGES.TASK_PROGRESS, progress: { current: i + 1, target: rows.length } });

      // Sleep between profiles (longer than within-profile sleeps)
      if (i < rows.length - 1) {
        await profileDelay(1.0);
      }
    }

    await finishTask({
      collected: rows.length,
      addedToSheet: added,
      skipped: rejected + errors,
      summary: { added, rejected, partial, errors, total: rows.length }
    });
    return { ok: true };
  } catch (e) {
    await failTask(e.message);
    return { ok: false, error: e.message };
  }
}
