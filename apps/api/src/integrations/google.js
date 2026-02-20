// apps/api/src/integrations/google.js
// Single source of truth for Google Business Profile API calls.
// IMPORTANT: All functions here take an *access token* (string), not a userId.

const ACCOUNT_MGMT_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const PERFORMANCE_BASE = 'https://businessprofileperformance.googleapis.com/v1';
const MYBUSINESS_V4_BASE = 'https://mybusiness.googleapis.com/v4';

// ---------- helpers ----------
function resolveAccessToken(accessOrObj) {
  if (!accessOrObj) return null;
  if (typeof accessOrObj === 'string') return accessOrObj;
  if (typeof accessOrObj === 'object' && typeof accessOrObj.access_token === 'string') return accessOrObj.access_token;
  return null;
}

async function callGoogleJson(url, accessToken, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(opts.headers || {}),
    },
  });

  const text = await r.text().catch(() => '');
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }

  if (!r.ok) {
    const err = new Error('google_http_error');
    err.status = r.status;
    err.body = body;
    throw err;
  }

  return body;
}

function datePartsFromAny(d) {
  if (!d) return null;
  if (typeof d === 'object' && Number(d.year) && Number(d.month) && Number(d.day)) {
    return { year: Number(d.year), month: Number(d.month), day: Number(d.day) };
  }
  const dt = d instanceof Date ? d : new Date(d);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function normalizePerformanceLocationName(locationName) {
  const s = String(locationName || '').trim();
  if (!s) return s;
  if (s.startsWith('locations/')) return s;

  // If stored as accounts/{acc}/locations/{loc}, extract loc
  const m = s.match(/\/locations\/([^/]+)$/);
  if (m) return `locations/${m[1]}`;

  return s; // fallback
}

function normalizeV4Parent(accountName, locationName) {
  const acc = String(accountName || '').trim();
  const loc = String(locationName || '').trim();

  // already full resource
  if (loc.startsWith('accounts/')) return loc;

  // expected: accounts/{acc}/locations/{loc}
  if (!acc) return loc;
  if (!loc) return acc;

  return `${acc}/${loc}`;
}

// ---------- accounts ----------
/**
 * List GBP accounts for the connected user.
 * IMPORTANT: This expects an ACCESS TOKEN (string), not userId.
 */
export async function listAccounts(accessToken) {
  const token = resolveAccessToken(accessToken);
  if (!token) {
    const e = new Error('missing_access_token');
    e.code = 'missing_access_token';
    throw e;
  }

  const out = { accounts: [] };
  let pageToken = null;

  while (true) {
    const qs = new URLSearchParams();
    if (pageToken) qs.set('pageToken', pageToken);

    const url = `${ACCOUNT_MGMT_BASE}/accounts?${qs.toString()}`;
    const data = await callGoogleJson(url, token);

    out.accounts.push(...(data.accounts || []));
    pageToken = data.nextPageToken || null;
    if (!pageToken) break;
  }

  return out;
}


// ---------- locations ----------
export async function listLocations(access, accountName) {
  const token = resolveAccessToken(access);
  if (!token) {
    const e = new Error('missing_access_token');
    e.code = 'missing_access_token';
    throw e;
  }
  if (!accountName) {
    const e = new Error('missing_accountName');
    e.code = 'missing_accountName';
    throw e;
  }

  const out = { locations: [] };
  let pageToken = null;

  const readMask = [
    'name',
    'title',
    'storeCode',
    'websiteUri',
    'storefrontAddress',
    'phoneNumbers',
    'metadata',
    'openInfo',
  ].join(',');

  while (true) {
    const qs = new URLSearchParams();
    qs.set('readMask', readMask);
    qs.set('pageSize', '100');
    if (pageToken) qs.set('pageToken', pageToken);

    const url = `${BUSINESS_INFO_BASE}/${accountName}/locations?${qs.toString()}`;
    const data = await callGoogleJson(url, token);

    out.locations.push(...(data.locations || []));
    pageToken = data.nextPageToken || null;
    if (!pageToken) break;
  }

  return out;
}

// ---------- performance ----------
// Shape expected by your extras router:
// fetchMultiDailyMetricsTimeSeries(locationName, accessToken, { dailyMetrics, startDate, endDate })
export async function fetchMultiDailyMetricsTimeSeries(locationName, access, req = {}) {
  const token = resolveAccessToken(access);
  if (!token) {
    const e = new Error('missing_access_token');
    e.code = 'missing_access_token';
    throw e;
  }
  if (!locationName) {
    const e = new Error('missing_locationName');
    e.code = 'missing_locationName';
    throw e;
  }

  const dailyMetrics = (req.dailyMetrics || req.metrics || []).map(String).filter(Boolean);
  const start = datePartsFromAny(req?.dailyRange?.startDate || req?.startDate);
  const end = datePartsFromAny(req?.dailyRange?.endDate || req?.endDate);

  if (!start || !end) {
    const e = new Error('missing_date_range');
    e.code = 'missing_date_range';
    throw e;
  }

  const qs = new URLSearchParams();
  for (const m of dailyMetrics) qs.append('dailyMetrics', m);

  // Google docs use snake_case keys: dailyRange.start_date.* and dailyRange.end_date.*
  qs.set('dailyRange.start_date.year', String(start.year));
  qs.set('dailyRange.start_date.month', String(start.month));
  qs.set('dailyRange.start_date.day', String(start.day));

  qs.set('dailyRange.end_date.year', String(end.year));
  qs.set('dailyRange.end_date.month', String(end.month));
  qs.set('dailyRange.end_date.day', String(end.day));

  const loc = normalizePerformanceLocationName(locationName);
  const url = `${PERFORMANCE_BASE}/${loc}:fetchMultiDailyMetricsTimeSeries?${qs.toString()}`;
  return callGoogleJson(url, token);
}

// Convenience wrapper used by routes/integrations.google.js
export async function fetchPerformance(access, locationName, { days = 30, metrics = [] } = {}) {
  const end = new Date();
  const start = new Date(end.getTime() - (Math.max(1, Number(days)) - 1) * 86400000);

  return fetchMultiDailyMetricsTimeSeries(locationName, access, {
    dailyMetrics: metrics,
    startDate: datePartsFromAny(start),
    endDate: datePartsFromAny(end),
  });
}

// ---------- reviews ----------
export async function listReviews(accountName, locationName, access, opts = {}) {
  const token = resolveAccessToken(access);
  if (!token) throw new Error('missing_access_token');

  const parent = normalizeV4Parent(accountName, locationName);
  const qs = new URLSearchParams();
  qs.set('pageSize', String(opts.pageSize || 50));
  if (opts.orderBy) qs.set('orderBy', String(opts.orderBy));
  if (opts.pageToken) qs.set('pageToken', String(opts.pageToken));

  const url = `${MYBUSINESS_V4_BASE}/${parent}/reviews?${qs.toString()}`;
  return callGoogleJson(url, token);
}

export async function updateReviewReply(reviewName, comment, access) {
  const token = resolveAccessToken(access);
  if (!token) throw new Error('missing_access_token');

  const url = `${MYBUSINESS_V4_BASE}/${reviewName}/reply`;
  return callGoogleJson(url, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: String(comment || '') }),
  });
}

// ---------- media ----------
export async function listLocationMedia(accountName, locationName, access, opts = {}) {
  const token = resolveAccessToken(access);
  if (!token) throw new Error('missing_access_token');

  const parent = normalizeV4Parent(accountName, locationName);
  const qs = new URLSearchParams();
  qs.set('pageSize', String(opts.pageSize || 10));
  if (opts.pageToken) qs.set('pageToken', String(opts.pageToken));

  const url = `${MYBUSINESS_V4_BASE}/${parent}/media?${qs.toString()}`;
  return callGoogleJson(url, token);
}

// ---------- posts ----------
export async function createLocalPost(access, accountName, locationName, post) {
  const token = resolveAccessToken(access);
  if (!token) {
    const e = new Error('missing_access_token');
    e.code = 'missing_access_token';
    throw e;
  }

  const parent = normalizeV4Parent(accountName, locationName);
  const url = `${MYBUSINESS_V4_BASE}/${parent}/localPosts`;

  return callGoogleJson(url, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(post),
  });
}

export async function listLocalPosts(access, accountName, locationName, opts = {}) {
  const token = resolveAccessToken(access);
  if (!token) throw new Error('missing_access_token');

  const parent = normalizeV4Parent(accountName, locationName);
  const qs = new URLSearchParams();
  qs.set('pageSize', String(opts.pageSize || 20));
  if (opts.pageToken) qs.set('pageToken', String(opts.pageToken));

  const url = `${MYBUSINESS_V4_BASE}/${parent}/localPosts?${qs.toString()}`;
  return callGoogleJson(url, token);
}
