import { describe, expect, it } from "vitest";
import { enterImageUrlState, selectImageFileState } from "./postImageForm";

describe("post image form state", () => {
  it("selecting and replacing a file clears the URL", () => {
    const first = new File(["a"], "a.png", { type: "image/png" });
    const second = new File(["b"], "b.png", { type: "image/png" });
    expect(selectImageFileState({ file: first })).toEqual({ imageFile: first, imageUrl: "" });
    expect(selectImageFileState({ file: second }).imageFile).toBe(second);
  });

  it("a non-empty URL clears the file and clearing it does not restore one", () => {
    expect(enterImageUrlState({ value: "https://example.com/a.png" })).toEqual({ imageFile: null, clearNativeFile: true });
    expect(enterImageUrlState({ value: "" })).toEqual({ imageFile: null, clearNativeFile: false });
  });
});
