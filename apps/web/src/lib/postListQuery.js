export function buildPostListQuery({
  locationId = "",
  showAll = false,
  keyword = "",
  status = "all",
  page = 1,
  perPage = 10,
} = {}) {
  const params = new URLSearchParams();
  if (!showAll && locationId) params.set("locationId", locationId);

  const cleanKeyword = String(keyword).trim();
  if (cleanKeyword) params.set("keyword", cleanKeyword);

  const cleanStatus = String(status).trim().toLowerCase();
  if (cleanStatus && cleanStatus !== "all") params.set("status", cleanStatus);

  params.set("page", String(page));
  params.set("perPage", String(perPage));
  return `?${params.toString()}`;
}
