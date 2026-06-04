// content/content.js — THIN ROUTER. Loaded LAST. All actual work lives in sibling
// scripts (extract-*.js, collect-*.js) which register functions on window.Cartograph.

(function () {
  const C = window.Cartograph;
  if (!C) {
    console.error('[Cartograph] utils.js did not initialize. Cannot start content router.');
    return;
  }
  const { MSG, STATE, log, err, isLoggedOut } = C;

  log('content.js (router) loading on', window.location.href);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.type) {
          case MSG.CONTENT_PING:
            sendResponse({ ok: true, ready: true, url: window.location.href });
            return;

          case MSG.CHECK_LOGIN:
            sendResponse({ ok: true, loggedIn: !isLoggedOut(), path: window.location.pathname });
            return;

          case MSG.STOP_CONTENT_TASK:
            STATE.cancelled = true;
            sendResponse({ ok: true });
            return;

          case MSG.EXTRACT_CONNECTIONS: {
            const result = await C.runExtractConnections(msg.params || {});
            sendResponse(result);
            if (result.ok) {
              chrome.runtime.sendMessage({
                type: MSG.CONTENT_TASK_COMPLETE,
                context: 'extract_connections',
                collected: result.collected,
                cancelled: result.cancelled
              }).catch(() => {});
            } else {
              chrome.runtime.sendMessage({
                type: MSG.CONTENT_TASK_FAILED,
                context: 'extract_connections',
                error: result.error
              }).catch(() => {});
            }
            return;
          }

          case MSG.EXTRACT_CAPELLA_PAGE_LINKS: {
            const result = await C.runExtractCapella(msg.params || {});
            sendResponse(result);
            if (result.ok) {
              chrome.runtime.sendMessage({
                type: MSG.CONTENT_TASK_COMPLETE,
                context: 'extract_capella_page',
                collected: result.collected,
                cancelled: result.cancelled
              }).catch(() => {});
            } else {
              chrome.runtime.sendMessage({
                type: MSG.CONTENT_TASK_FAILED,
                context: 'extract_capella_page',
                error: result.error
              }).catch(() => {});
            }
            return;
          }

          // Per-profile collector commands. These are short-lived requests that
          // return synchronously (well, after one async DOM read). They do NOT
          // emit CONTENT_TASK_COMPLETE — the orchestrator manages the outer task.
          case MSG.COLLECT_EDUCATION: {
            const result = await C.runCollectEducation(msg.params || {});
            sendResponse(result);
            return;
          }
          case MSG.COLLECT_NAME_HEADLINE: {
            const result = await C.runCollectNameHeadline(msg.params || {});
            sendResponse(result);
            return;
          }
          case MSG.COLLECT_LOCATION: {
            const result = await C.runCollectLocation(msg.params || {});
            sendResponse(result);
            return;
          }
          case MSG.COLLECT_CONTACT: {
            const result = await C.runCollectContact(msg.params || {});
            sendResponse(result);
            return;
          }

          default:
            // Ignore unknown messages (could be intended for other listeners)
            return;
        }
      } catch (e) {
        err('Router error:', e);
        try { sendResponse({ ok: false, error: e.message }); } catch {}
      }
    })();
    return true; // async sendResponse
  });

  log('content.js (router) ready.');
})();
