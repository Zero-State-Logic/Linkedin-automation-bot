// Shared constants used across the extension
// Imported by popup, options, service worker, and content scripts

export const STORAGE_KEYS = {
  APPS_SCRIPT_URL: 'appsScriptUrl',
  DELAY_MULTIPLIER: 'delayMultiplier',
  MAX_LINKS_PER_SESSION: 'maxLinksPerSession',
  YEAR_RANGE_OVERRIDE: 'yearRangeOverride', // { start: number, end: number } | null
  LAST_RUN: 'lastRun',                      // { type, count, timestamp, ok }
  CURRENT_TASK: 'currentTask',              // null when idle
  SEEN_URLS_CACHE: 'seenUrlsCache',         // string[]  (normalized)
  SEEN_URLS_CACHE_AT: 'seenUrlsCacheAt'     // ISO date string
};

export const DEFAULT_SETTINGS = {
  appsScriptUrl: '',
  delayMultiplier: 1.0,
  maxLinksPerSession: 500,
  yearRangeOverride: null
};

export const TASK_TYPES = {
  EXTRACT_CONNECTIONS: 'extract_connections',
  EXTRACT_CAPELLA_PAGE: 'extract_capella_page',
  COLLECT_ALL: 'collect_all',
  COLLECT_EDUCATION: 'collect_education',
  COLLECT_NAMES: 'collect_names',
  COLLECT_LOCATIONS: 'collect_locations',
  COLLECT_CONTACT: 'collect_contact'
};

export const TASK_LABELS = {
  [TASK_TYPES.EXTRACT_CONNECTIONS]: 'Extract Connections',
  [TASK_TYPES.EXTRACT_CAPELLA_PAGE]: 'Extract Capella Alumni',
  [TASK_TYPES.COLLECT_ALL]: 'Collect All Fields',
  [TASK_TYPES.COLLECT_EDUCATION]: 'Collect Education',
  [TASK_TYPES.COLLECT_NAMES]: 'Collect Names',
  [TASK_TYPES.COLLECT_LOCATIONS]: 'Collect Locations',
  [TASK_TYPES.COLLECT_CONTACT]: 'Collect Contact Info'
};

export const STATUS = {
  PENDING: 'pending',
  COLLECTED: 'collected',
  REJECTED: 'rejected',
  PARTIAL: 'partial'
};

export const MESSAGES = {
  // popup -> service worker
  PING_APPS_SCRIPT: 'ping_apps_script',
  START_TASK: 'start_task',
  CANCEL_TASK: 'cancel_task',
  GET_TASK_STATUS: 'get_task_status',
  // service worker -> popup
  TASK_PROGRESS: 'task_progress',
  TASK_COMPLETE: 'task_complete',
  TASK_FAILED: 'task_failed',
  // service worker <-> content script (extract)
  CONTENT_PING: 'content_ping',
  CHECK_LOGIN: 'check_login',
  EXTRACT_CONNECTIONS: 'extract_connections',
  EXTRACT_CAPELLA_PAGE_LINKS: 'extract_capella_page_links',
  STOP_CONTENT_TASK: 'stop_content_task',
  // service worker <-> content script (collect)
  COLLECT_EDUCATION: 'collect_education',
  COLLECT_NAME_HEADLINE: 'collect_name_headline',
  COLLECT_LOCATION: 'collect_location',
  COLLECT_CONTACT: 'collect_contact',
  // content -> service worker
  LINKS_BATCH: 'links_batch',
  CONTENT_TASK_COMPLETE: 'content_task_complete',
  CONTENT_TASK_FAILED: 'content_task_failed'
};

// LinkedIn URL patterns
export const LINKEDIN = {
  CONNECTIONS_URL: 'https://www.linkedin.com/mynetwork/invite-connect/connections/',
  CAPELLA_PEOPLE_URL: 'https://www.linkedin.com/school/capella-university/people/',
  PROFILE_PATTERN: /linkedin\.com\/in\//i,
  DETAILS_EDUCATION_SUFFIX: 'details/education/'
};

// Build the Capella alumni URL with current year range (curYear-1 to curYear+1)
export function buildCapellaUrl(startYear, endYear) {
  const now = new Date().getFullYear();
  const s = startYear || (now - 1);
  const e = endYear || (now + 1);
  return `${LINKEDIN.CAPELLA_PEOPLE_URL}?educationStartYear=${s}&educationEndYear=${e}`;
}
