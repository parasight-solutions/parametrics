export const POST_LIST_DEFAULT_PER_PAGE = 10;
export const POST_LIST_MAX_PER_PAGE = 100;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "bad_request";
  return error;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) throw badRequest(`${name} must be a positive integer`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw badRequest(`${name} must be a positive integer`);
  }
  return parsed;
}

export function normalizePostListQuery(query = {}) {
  const page = positiveInteger(query.page, 1, "page");
  const requestedPerPage = positiveInteger(
    query.perPage ?? query.per_page,
    POST_LIST_DEFAULT_PER_PAGE,
    "perPage",
  );
  const rawStatus = String(query.status ?? "").trim().toLowerCase();

  return {
    keyword: String(query.keyword ?? "").trim().slice(0, 200),
    status: rawStatus === "all" ? "" : rawStatus,
    page,
    perPage: Math.min(requestedPerPage, POST_LIST_MAX_PER_PAGE),
  };
}

export function createKeywordRegex(keyword) {
  const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i");
}

export function buildPostListFilter({
  baseFilter,
  keyword = "",
  status = "",
  matchingLocationIds = [],
}) {
  const filter = { ...baseFilter };
  if (status) filter.status = status;

  if (keyword) {
    const pattern = createKeywordRegex(keyword);
    filter.$or = [
      { summary: pattern },
      { location_id: pattern },
      { provider_post_name: pattern },
      { status: pattern },
      { provider_error: pattern },
    ];
    if (matchingLocationIds.length) {
      filter.$or.push({ location_id: { $in: matchingLocationIds } });
    }
  }

  return filter;
}
