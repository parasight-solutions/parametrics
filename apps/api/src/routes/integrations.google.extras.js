// apps/api/src/routes/integrations.google.extras.js
import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { mutationRateLimit, syncRateLimit } from '../middleware/rateLimit.js';
import { col } from '../lib/mongo.js';
import { getActiveGoogleIntegration, getGoogleIntegrationById, ensureAccessToken } from '../integrations/google.store.js';
import {
  fetchMultiDailyMetricsTimeSeries,
  listReviews,
  updateReviewReply,
  listLocationMedia,
} from '../integrations/google.js';
import { auditFailure, auditSuccess } from '../services/auditLog.js';

const router = express.Router();

function isGoogleAuthFailure(e) {
  const status = Number(e?.status || 0);
  const body = e?.body || {};
  const providerCode = Number(body?.error?.code || 0);
  const providerStatus = String(body?.error?.status || '').toUpperCase();
  const providerMessage = String(body?.error?.message || e?.message || '').toLowerCase();

  if (status === 401 || providerCode === 401 || providerStatus === 'UNAUTHENTICATED') {
    return true;
  }

  if (
    status === 403 &&
    (
      providerStatus === 'PERMISSION_DENIED' ||
      providerMessage.includes('permission') ||
      providerMessage.includes('scope') ||
      providerMessage.includes('access denied')
    )
  ) {
    return true;
  }

  return false;
}

function sendGoogleFailure(res, e, fallbackCode = 'google_error') {
  const upstreamStatus = Number(e?.status || 502);
  const body = e?.body || null;

  if (e?.code === 'reauth_required' || isGoogleAuthFailure(e)) {
    return res.status(409).json({
      error: {
        code: 'reauth_required',
        message: 'Google connection expired, revoked, or no longer has access. Please reconnect Google.',
        details: body,
      },
    });
  }

  return res.status(502).json({
    error: {
      code: fallbackCode,
      message: e?.message || fallbackCode,
      status: upstreamStatus,
      body,
    },
  });
}

function toDateParts(d) {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function getOwnedLocation(userId, locationId) {
  const locations = await col('locations');
  const doc = await locations.findOne({ id: locationId, user_id: userId });
  if (!doc) return null;
  if (!doc.provider_account_name || !doc.provider_location_name) return null;
  return doc;
}

async function getAccessTokenForLocation(userId, loc) {
  const integ = loc?.integration_id
    ? await getGoogleIntegrationById(userId, loc.integration_id)
    : await getActiveGoogleIntegration(userId);

  if (!integ) {
    const e = new Error('no_integration');
    e.code = 'no_integration';
    throw e;
  }

  const tokenObj = await ensureAccessToken(integ);
  const accessToken = tokenObj?.access_token || tokenObj?.accessToken || tokenObj;

  if (!accessToken || typeof accessToken !== 'string') {
    const e = new Error('missing_access_token');
    e.code = 'missing_access_token';
    throw e;
  }

  return accessToken;
}

const ALLOWED_DAILY_METRICS = new Set([
  'WEBSITE_CLICKS',
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_FOOD_ORDERS',
  'BUSINESS_FOOD_MENU_CLICKS',
]);

const METRIC_ALIASES = {
  DIRECTIONS_REQUESTS: ['BUSINESS_DIRECTION_REQUESTS'],
  BUSINESS_IMPRESSIONS_SEARCH: [
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  ],
  BUSINESS_IMPRESSIONS_MAPS: [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  ],
};

function normalizeMetricName(m) {
  return String(m || '').trim().toUpperCase();
}

function expandAndValidateMetrics(requestedMetrics) {
  const requested = (requestedMetrics || [])
    .map(normalizeMetricName)
    .filter(Boolean);

  const groups = [];
  const expandedSet = new Set();

  for (const key of requested) {
    const expanded = METRIC_ALIASES[key] || [key];
    for (const m of expanded) {
      if (!ALLOWED_DAILY_METRICS.has(m)) {
        const e = new Error(`invalid_metric:${m}`);
        e.code = 'invalid_metric';
        e.metric = m;
        e.allowed = Array.from(ALLOWED_DAILY_METRICS).sort();
        throw e;
      }
      expandedSet.add(m);
    }
    groups.push({ key, expanded });
  }

  return { requested, expanded: Array.from(expandedSet), groups };
}

function buildPointsByMetric(raw) {
  const points = new Map();

  for (const series of (raw?.multiDailyMetricTimeSeries || [])) {
    for (const s of (series?.dailyMetricTimeSeries || [])) {
      const metric = s?.dailyMetric;
      if (!metric) continue;

      if (!points.has(metric)) points.set(metric, new Map());
      const bucket = points.get(metric);

      for (const v of (s?.timeSeries?.datedValues || [])) {
        const d = v?.date;
        if (!d?.year || !d?.month || !d?.day) continue;
        const key = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        bucket.set(key, (bucket.get(key) || 0) + Number(v?.value || 0));
      }
    }
  }

  return points;
}

router.get('/performance-series', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = req.query.locationId || req.query.location_id;

    if (!locationId) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'locationId required' } });
    }

    const loc = await getOwnedLocation(userId, locationId);
    if (!loc) {
      return res.status(404).json({ error: { code: 'not_found', message: 'location not found' } });
    }

    const accessToken = await getAccessTokenForLocation(userId, loc);

    const clampDays = (n) => Math.min(Math.max(Number(n || 30), 1), 366);

    function parseYmdStrict(s) {
      const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || (dt.getUTCMonth() + 1) !== mo || dt.getUTCDate() !== d) return null;
      return dt;
    }

    const qsStart = req.query.start;
    const qsEnd = req.query.end;

    let start = null;
    let end = null;

    if (qsStart && qsEnd) {
      start = parseYmdStrict(qsStart);
      end = parseYmdStrict(qsEnd);

      if (!start || !end) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'start/end must be YYYY-MM-DD' } });
      }
      if (end.getTime() < start.getTime()) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'end must be >= start' } });
      }

      const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      if (days < 1 || days > 366) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'range too large (max 366 days)' } });
      }
    } else {
      const days = clampDays(req.query.days);
      end = new Date();
      const utcEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
      end = utcEnd;
      start = new Date(end.getTime() - (days - 1) * 86400000);
    }

    const todayUtc = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate()
    ));

    if (end.getTime() > todayUtc.getTime()) end = todayUtc;
    if (start.getTime() > end.getTime()) start = end;

    const daysFinal = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;

    const requestedMetrics = (req.query.metrics
      ? String(req.query.metrics).split(',')
      : [
        'WEBSITE_CLICKS',
        'CALL_CLICKS',
        'DIRECTIONS_REQUESTS',
        'BUSINESS_IMPRESSIONS_SEARCH',
        'BUSINESS_IMPRESSIONS_MAPS',
      ]
    ).map((s) => s.trim()).filter(Boolean);

    const { expanded, groups } = expandAndValidateMetrics(requestedMetrics);

    const raw = await fetchMultiDailyMetricsTimeSeries(
      loc.provider_location_name,
      accessToken,
      {
        dailyMetrics: expanded,
        startDate: toDateParts(start),
        endDate: toDateParts(end),
      }
    );

    const pointsByMetric = buildPointsByMetric(raw);

    const series = groups.map((g) => {
      const agg = new Map();

      for (const m of g.expanded) {
        const mp = pointsByMetric.get(m) || new Map();
        for (const [date, val] of mp.entries()) {
          agg.set(date, (agg.get(date) || 0) + val);
        }
      }

      const points = Array.from(agg.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date, value }));

      const total = points.reduce((s, p) => s + p.value, 0);
      return { metric: g.key, total, points };
    });

    return res.json({
      location: { id: loc.id, title: loc.title, provider: loc.provider },
      range: { start: ymd(start), end: ymd(end), days: daysFinal },
      metrics: series,
      expanded_metrics_used: expanded,
    });
  } catch (e) {
    if (e?.code === 'reauth_required') {
      return res.status(409).json({
        error: {
          code: 'reauth_required',
          message: 'Google connection expired/revoked. Please reconnect Google.',
          details: e?.body || null,
        },
      });
    }

    if (e?.code === 'invalid_metric') {
      return res.status(400).json({
        error: {
          code: 'bad_request',
          message: `Invalid metric: ${e.metric}`,
          allowed: e.allowed,
        },
      });
    }

    if (e?.message === 'google_http_error') {
      return sendGoogleFailure(res, e, 'performance_failed');
    }

    return res.status(500).json({
      error: {
        code: 'server_error',
        message: e?.message || 'server_error',
        data: e?.data || null,
      },
    });
  }
});

router.get('/reviews', authenticate, syncRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = req.query.locationId || req.query.location_id;

    if (!locationId) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'locationId required' } });
    }

    const loc = await getOwnedLocation(userId, locationId);
    if (!loc) {
      return res.status(404).json({ error: { code: 'not_found', message: 'location not found' } });
    }

    const accessToken = await getAccessTokenForLocation(userId, loc);

    const data = await listReviews(
      loc.provider_account_name,
      loc.provider_location_name,
      accessToken,
      { pageSize: 50, orderBy: 'updateTime desc' }
    );

    return res.json({
      reviews: data.reviews || [],
      nextPageToken: data.nextPageToken || null,
    });
  } catch (e) {
    if (e?.code === 'reauth_required') {
      return res.status(409).json({
        error: {
          code: 'reauth_required',
          message: 'Google connection expired/revoked. Please reconnect Google.',
          details: e?.body || null,
        },
      });
    }

    if (e?.message === 'google_http_error') {
      return sendGoogleFailure(res, e, 'reviews_failed');
    }

    return res.status(500).json({
      error: {
        code: 'server_error',
        message: e?.message || 'server_error',
        data: e?.data || null,
      },
    });
  }
});

router.put('/reviews/reply', authenticate, mutationRateLimit, async (req, res) => {
  let auditTarget = {};
  try {
    const userId = req.user.user_id;
    const { locationId, reviewName, comment } = req.body || {};

    if (!locationId || !reviewName || !comment) {
      return res.status(400).json({
        error: {
          code: 'bad_request',
          message: 'locationId + reviewName + comment required',
        },
      });
    }

    const loc = await getOwnedLocation(userId, locationId);
    if (!loc) {
      return res.status(404).json({ error: { code: 'not_found', message: 'location not found' } });
    }
    auditTarget = {
      target_type: 'review',
      target_id: reviewName,
      organization_id: loc.organization_id || null,
      client_id: loc.client_id || null,
      location_id: loc.id,
      provider: 'google',
    };

    const accessToken = await getAccessTokenForLocation(userId, loc);
    await auditSuccess(req, 'review.reply.attempt', auditTarget);
    const out = await updateReviewReply(reviewName, comment, accessToken);
    await auditSuccess(req, 'review.reply', auditTarget);
    return res.json({ reply: out });
  } catch (e) {
    await auditFailure(req, 'review.reply', {
      ...auditTarget,
      metadata: { reason: e?.message || e?.code || 'server_error' },
    });
    if (e?.code === 'reauth_required') {
      return res.status(409).json({
        error: {
          code: 'reauth_required',
          message: 'Google connection expired/revoked. Please reconnect Google.',
          details: e?.body || null,
        },
      });
    }

    if (e?.message === 'google_http_error') {
      return sendGoogleFailure(res, e, 'review_reply_failed');
    }

    return res.status(500).json({
      error: {
        code: 'server_error',
        message: e?.message || 'server_error',
        data: e?.data || null,
      },
    });
  }
});

router.get('/media', authenticate, syncRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = req.query.locationId || req.query.location_id;

    if (!locationId) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'locationId required' } });
    }

    const loc = await getOwnedLocation(userId, locationId);
    if (!loc) {
      return res.status(404).json({ error: { code: 'not_found', message: 'location not found' } });
    }

    const accessToken = await getAccessTokenForLocation(userId, loc);
    const data = await listLocationMedia(
      loc.provider_account_name,
      loc.provider_location_name,
      accessToken,
      { pageSize: 10 }
    );

    return res.json({ mediaItems: data.mediaItems || [] });
  } catch (e) {
    if (e?.code === 'reauth_required') {
      return res.status(409).json({
        error: {
          code: 'reauth_required',
          message: 'Google connection expired/revoked. Please reconnect Google.',
          details: e?.body || null,
        },
      });
    }

    if (e?.message === 'google_http_error') {
      return sendGoogleFailure(res, e, 'media_failed');
    }

    return res.status(500).json({
      error: {
        code: 'server_error',
        message: e?.message || 'server_error',
        data: e?.data || null,
      },
    });
  }
});

export default router;
