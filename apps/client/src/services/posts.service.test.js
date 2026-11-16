import { describe, expect, it } from "vitest";
import { buildCreatePostFormData } from "./posts.service";

describe("buildCreatePostFormData", () => {
  it("serializes scalar values and gives a file priority over URL", () => {
    const file = new File(["x"], "x.png", { type: "image/png" });
    const form = buildCreatePostFormData({ locationId: "l1", publishNow: false, scheduleAt: null, imageUrl: "https://example.com/x", imageFile: file });
    expect(form.get("locationId")).toBe("l1");
    expect(form.get("publishNow")).toBe("false");
    expect(form.get("scheduleAt")).toBeNull();
    expect(form.get("imageFile")).toBe(file);
    expect(form.get("imageUrl")).toBeNull();
  });
});
