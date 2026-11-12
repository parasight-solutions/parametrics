import { describe, expect, it } from "vitest";
import { buildPostListQuery } from "./postListQuery.js";

describe("buildPostListQuery", () => {
  it("includes location filters and pagination with encoded keyword", () => {
    expect(
      buildPostListQuery({
        locationId: "location/1",
        showAll: false,
        keyword: "summer + sale",
        status: "published",
        page: 2,
        perPage: 10,
      }),
    ).toBe(
      "?locationId=location%2F1&keyword=summer+%2B+sale&status=published&page=2&perPage=10",
    );
  });

  it("omits inactive filters while retaining pagination defaults", () => {
    expect(
      buildPostListQuery({
        locationId: "location-1",
        showAll: true,
        keyword: "   ",
        status: "all",
      }),
    ).toBe("?page=1&perPage=10");
  });
});
