import { describe, expect, it, vi } from "vitest";
import { isProviderPostUrl, openProviderPost } from "./providerPostUrl";

describe("openProviderPost", () => {
  it("identifies only HTTPS values as navigable provider URLs", () => {
    expect(isProviderPostUrl("https://posts.gle/example")).toBe(true);
    expect(isProviderPostUrl("javascript:alert(1)")).toBe(false);
    expect(isProviderPostUrl(null)).toBe(false);
  });

  it("opens an HTTPS provider URL in an isolated new tab", () => {
    const openWindow = vi.fn();

    expect(openProviderPost("https://posts.gle/example", openWindow)).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(
      "https://posts.gle/example",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it.each([null, "", "http://posts.gle/example", "javascript:alert(1)", "not a url"])(
    "does not open an unavailable or unsafe URL: %s",
    (url) => {
      const openWindow = vi.fn();

      expect(openProviderPost(url, openWindow)).toBe(false);
      expect(openWindow).not.toHaveBeenCalled();
    },
  );
});
