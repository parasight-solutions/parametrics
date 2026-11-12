import test from "node:test";
import assert from "node:assert/strict";
import { buildPostListFilter, normalizePostListQuery } from "./postList.js";

test("post list query defaults to the first page with ten rows", () => {
  assert.deepEqual(normalizePostListQuery({}), {
    keyword: "",
    status: "",
    page: 1,
    perPage: 10,
  });
});

test("post list query normalizes filters and caps perPage", () => {
  assert.deepEqual(
    normalizePostListQuery({
      keyword: "  Summer + Sale  ",
      status: " PUBLISHED ",
      page: "3",
      perPage: "500",
    }),
    {
      keyword: "Summer + Sale",
      status: "published",
      page: 3,
      perPage: 100,
    },
  );
  assert.equal(normalizePostListQuery({ status: "all" }).status, "");
});

test("post list query rejects invalid page values", () => {
  for (const page of ["zero", "0", "1.5", -1]) {
    assert.throws(
      () => normalizePostListQuery({ page }),
      (error) => error?.status === 400 && error?.code === "bad_request",
    );
  }
});

test("post list filter treats keyword metacharacters literally", () => {
  const filter = buildPostListFilter({
    baseFilter: { user_id: "user-1" },
    keyword: "a+b",
    status: "published",
    matchingLocationIds: ["location-2"],
  });

  assert.equal(filter.user_id, "user-1");
  assert.equal(filter.status, "published");
  assert.equal(filter.$or[0].summary.test("A+B offer"), true);
  assert.equal(filter.$or[0].summary.test("ab offer"), false);
  assert.deepEqual(filter.$or.at(-1), {
    location_id: { $in: ["location-2"] },
  });
});
