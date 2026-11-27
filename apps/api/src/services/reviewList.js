export const REVIEW_LIST_DEFAULT_PER_PAGE = 10;
export const REVIEW_LIST_MAX_PER_PAGE = 100;

const REVIEW_STATUSES = new Set(["all", "replied", "unreplied"]);
const PROVIDER_SYNC_STATUSES = new Set(["active", "missing", "unavailable"]);
const AVAILABILITY_DATE_FIELDS = [
  "provider_first_seen_at",
  "provider_last_seen_at",
  "provider_missing_since",
  "provider_last_checked_at",
];
const REVIEW_STAR_RATINGS = Object.freeze({
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
});

export function normalizeReviewStarRating(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  const mapped = typeof normalized === "string"
    ? REVIEW_STAR_RATINGS[normalized.toUpperCase()]
    : undefined;
  const rating = mapped ?? Number(normalized);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "bad_request";
  return error;
}

function optionalScalar(value, name) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw badRequest(`${name} must be a scalar value`);
  }
  return String(value).trim();
}

function positiveInteger(value, fallback, name) {
  const normalized = optionalScalar(value, name);
  if (!normalized) return fallback;
  if (!/^\d+$/.test(normalized)) {
    throw badRequest(`${name} must be a positive integer`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw badRequest(`${name} must be a positive integer`);
  }
  return parsed;
}

export function normalizeReviewListQuery(query = {}) {
  const status = optionalScalar(query.status, "status").toLowerCase() || "all";
  if (!REVIEW_STATUSES.has(status)) {
    throw badRequest("status must be all, replied, or unreplied");
  }

  const keyword = optionalScalar(query.keyword, "keyword");
  if (keyword.length > 200) {
    throw badRequest("keyword must be 200 characters or fewer");
  }

  const page = positiveInteger(query.page, 1, "page");
  const requestedPerPage = positiveInteger(
    query.perPage ?? query.per_page,
    REVIEW_LIST_DEFAULT_PER_PAGE,
    "perPage",
  );

  return {
    status,
    keyword,
    page,
    perPage: Math.min(requestedPerPage, REVIEW_LIST_MAX_PER_PAGE),
  };
}

function literalRegex(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i");
}

export function buildReviewReplyExpression() {
  return {
    $gt: [
      {
        $strLenCP: {
          $trim: {
            chars: "\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF",
            input: {
              $cond: [
                { $eq: [{ $type: "$reviewReply.comment" }, "string"] },
                "$reviewReply.comment",
                "",
              ],
            },
          },
        },
      },
      0,
    ],
  };
}

function matchingStage(query) {
  const conditions = [];
  const replied = buildReviewReplyExpression();

  if (query.status === "replied") conditions.push({ $expr: replied });
  if (query.status === "unreplied") {
    conditions.push({ $expr: { $eq: [replied.$gt[0], 0] } });
  }
  if (query.keyword) {
    const pattern = literalRegex(query.keyword);
    conditions.push({
      $or: [
        { "reviewer.displayName": pattern },
        { "reviewer.name": pattern },
        { comment: pattern },
        { "reviewReply.comment": pattern },
      ],
    });
  }

  if (!conditions.length) return [];
  return [{ $match: conditions.length === 1 ? conditions[0] : { $and: conditions } }];
}

export function buildReviewListPipeline({ baseFilter, query }) {
  const match = matchingStage(query);
  const replied = buildReviewReplyExpression();
  const skip = (query.page - 1) * query.perPage;

  return [
    { $match: { ...baseFilter } },
    {
      $facet: {
        reviews: [
          ...match,
          { $sort: { updateTime: -1, createTime: -1, _id: -1 } },
          { $skip: skip },
          { $limit: query.perPage },
          { $project: { _id: 0 } },
        ],
        matching: [...match, { $count: "value" }],
        total: [{ $count: "value" }],
        replied: [{ $match: { $expr: replied } }, { $count: "value" }],
        unreplied: [
          { $match: { $expr: { $eq: [replied.$gt[0], 0] } } },
          { $count: "value" },
        ],
      },
    },
  ];
}

function countOf(bucket) {
  const value = bucket?.[0]?.value;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function availabilityDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeReviewAvailability(review) {
  const normalized = {
    ...review,
    provider_sync_status: PROVIDER_SYNC_STATUSES.has(review?.provider_sync_status)
      ? review.provider_sync_status
      : "active",
    provider_consecutive_misses: Number.isSafeInteger(review?.provider_consecutive_misses)
      && review.provider_consecutive_misses >= 0
      ? review.provider_consecutive_misses
      : 0,
  };
  for (const field of AVAILABILITY_DATE_FIELDS) {
    normalized[field] = availabilityDate(review?.[field]);
  }
  return normalized;
}

export function readReviewListFacet(result, query) {
  const facet = result?.[0] || {};
  const total = countOf(facet.matching);
  return {
    reviews: Array.isArray(facet.reviews)
      ? facet.reviews.map((review) => ({
        ...normalizeReviewAvailability(review),
        starRating: normalizeReviewStarRating(review?.starRating),
      }))
      : [],
    pagination: {
      page: query.page,
      perPage: query.perPage,
      total,
      totalPages: total ? Math.ceil(total / query.perPage) : 0,
    },
    counts: {
      total: countOf(facet.total),
      replied: countOf(facet.replied),
      unreplied: countOf(facet.unreplied),
    },
  };
}
