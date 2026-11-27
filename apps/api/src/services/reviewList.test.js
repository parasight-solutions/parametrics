import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewListPipeline,
  buildReviewReplyExpression,
  normalizeReviewListQuery,
  readReviewListFacet,
  normalizeReviewStarRating,
} from "./reviewList.js";

function isBadRequest(fn) {
  assert.throws(fn, (error) => error?.status === 400 && error?.code === "bad_request");
}

function evaluateReplyExpression(expression, review) {
  const value = review?.reviewReply?.comment;
  const normalized = typeof value === "string" ? value.trim() : "";
  assert.deepEqual(expression, {
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
  });
  return normalized.length > 0;
}

test("review list query defaults to all statuses and ten rows", () => {
  assert.deepEqual(normalizeReviewListQuery({}), {
    status: "all",
    keyword: "",
    page: 1,
    perPage: 10,
  });
});

test("review list query accepts aliases, trims values, and caps page size", () => {
  assert.deepEqual(normalizeReviewListQuery({
    status: " REPLIED ",
    keyword: "  Café + tea  ",
    page: "3",
    per_page: "500",
  }), {
    status: "replied",
    keyword: "Café + tea",
    page: 3,
    perPage: 100,
  });
});

test("review list query rejects malformed scalars and unsupported statuses", () => {
  for (const query of [
    { page: ["1"] },
    { page: {} },
    { page: "0" },
    { page: "1.5" },
    { perPage: -1 },
    { perPage: [10] },
    { keyword: ["hello"] },
    { keyword: {} },
    { status: ["all"] },
    { status: "pending" },
    { keyword: "x".repeat(201) },
  ]) {
    isBadRequest(() => normalizeReviewListQuery(query));
  }
});

test("review reply expression treats only non-blank strings as replied", () => {
  const expression = buildReviewReplyExpression();
  const cases = [
    [{}, false],
    [{ reviewReply: { comment: null } }, false],
    [{ reviewReply: { comment: 42 } }, false],
    [{ reviewReply: { comment: "" } }, false],
    [{ reviewReply: { comment: " \t\n " } }, false],
    [{ reviewReply: { comment: "　" } }, false],
    [{ reviewReply: { comment: "  Thanks for visiting  " } }, true],
  ];
  for (const [review, expected] of cases) {
    assert.equal(evaluateReplyExpression(expression, review), expected);
  }
});

test("review list pipeline scopes first and combines literal keyword and status", () => {
  const pipeline = buildReviewListPipeline({
    baseFilter: {
      user_id: "user-1",
      organization_id: "org-1",
      client_id: "client-1",
      location_id: "location-1",
      provider: "google",
    },
    query: { status: "unreplied", keyword: "a+b", page: 2, perPage: 10 },
  });

  assert.deepEqual(pipeline[0], {
    $match: {
      user_id: "user-1",
      organization_id: "org-1",
      client_id: "client-1",
      location_id: "location-1",
      provider: "google",
    },
  });
  const facet = pipeline[1].$facet;
  assert.equal(facet.reviews[0].$match.$and.length, 2);
  const keywordMatch = facet.reviews[0].$match.$and[1].$or;
  assert.equal(keywordMatch.length, 4);
  assert.equal(keywordMatch[0]["reviewer.displayName"].test("A+B customer"), true);
  assert.equal(keywordMatch[0]["reviewer.displayName"].test("ab customer"), false);
  assert.deepEqual(facet.reviews.slice(1), [
    { $sort: { updateTime: -1, createTime: -1, _id: -1 } },
    { $skip: 10 },
    { $limit: 10 },
    { $project: { _id: 0 } },
  ]);
  assert.deepEqual(facet.matching.at(-1), { $count: "value" });
  assert.deepEqual(facet.total, [{ $count: "value" }]);
  assert.deepEqual(facet.replied.at(-1), { $count: "value" });
  assert.deepEqual(facet.unreplied.at(-1), { $count: "value" });
});

test("review list facet reader preserves requested out-of-range page", () => {
  assert.deepEqual(readReviewListFacet([{
    reviews: [],
    matching: [{ value: 21 }],
    total: [{ value: 40 }],
    replied: [{ value: 12 }],
    unreplied: [{ value: 28 }],
  }], { status: "all", keyword: "", page: 4, perPage: 10 }), {
    reviews: [],
    pagination: { page: 4, perPage: 10, total: 21, totalPages: 3 },
    counts: { total: 40, replied: 12, unreplied: 28 },
  });
});

test("review list facet reader defaults absent buckets to empty values", () => {
  assert.deepEqual(readReviewListFacet([], { page: 1, perPage: 10 }), {
    reviews: [],
    pagination: { page: 1, perPage: 10, total: 0, totalPages: 0 },
    counts: { total: 0, replied: 0, unreplied: 0 },
  });
});

test("review star ratings normalize provider enums and valid numeric values", () => {
  const cases = [
    ["ONE", 1], ["TWO", 2], ["THREE", 3], ["FOUR", 4], ["FIVE", 5],
    [1, 1], [5, 5], ["3", 3],
    [0, null], [6, null], ["ZERO", null], [null, null], [undefined, null],
    [true, null], [[], null], [{}, null],
  ];
  for (const [input, expected] of cases) assert.equal(normalizeReviewStarRating(input), expected);
});

test("review list facet reader exposes numeric ratings without mutating source rows", () => {
  const source = { id: "review-1", starRating: "FOUR" };
  const result = readReviewListFacet([{
    reviews: [source], matching: [{ value: 1 }], total: [{ value: 1 }],
    replied: [], unreplied: [{ value: 1 }],
  }], { page: 1, perPage: 10 });

  assert.equal(result.reviews[0].starRating, 4);
  assert.equal(source.starRating, "FOUR");
});

test("review list facet reader exposes availability metadata with ISO dates and legacy defaults", () => {
  const query = normalizeReviewListQuery({});
  const result = readReviewListFacet([{
    reviews: [
      {
        id: "review-active",
        provider_sync_status: "missing",
        provider_first_seen_at: new Date("2026-11-25T08:00:00.000Z"),
        provider_last_seen_at: "2026-11-26T08:00:00.000Z",
        provider_missing_since: new Date("2026-11-27T08:00:00.000Z"),
        provider_last_checked_at: new Date("2026-11-27T08:00:00.000Z"),
        provider_consecutive_misses: 1,
      },
      { id: "review-legacy" },
    ],
  }], query);

  assert.deepEqual(result.reviews[0], {
    id: "review-active",
    starRating: null,
    provider_sync_status: "missing",
    provider_first_seen_at: "2026-11-25T08:00:00.000Z",
    provider_last_seen_at: "2026-11-26T08:00:00.000Z",
    provider_missing_since: "2026-11-27T08:00:00.000Z",
    provider_last_checked_at: "2026-11-27T08:00:00.000Z",
    provider_consecutive_misses: 1,
  });
  assert.deepEqual(result.reviews[1], {
    id: "review-legacy",
    starRating: null,
    provider_sync_status: "active",
    provider_first_seen_at: null,
    provider_last_seen_at: null,
    provider_missing_since: null,
    provider_last_checked_at: null,
    provider_consecutive_misses: 0,
  });
});
