import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCacheKeys,
  readCacheEntry,
  runDedupedRequest,
  shouldInvalidateCache,
  writeCacheEntry,
} from "./useCachedApi";

function createStorage() {
  const data = new Map();
  return {
    getItem: vi.fn((key) => data.get(key) ?? null),
    removeItem: vi.fn((key) => data.delete(key)),
    setItem: vi.fn((key, value) => data.set(key, value)),
  };
}

const envelope = {
  success: true,
  statusCode: 200,
  message: "Posts fetched",
  data: { posts: [{ id: "post-1" }] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cache v2 migration", () => {
  it("removes and ignores the matching v1 raw-payload entry", () => {
    const store = createStorage();
    const keys = buildCacheKeys("/posts", { method: "GET" });
    store.setItem(
      keys.legacy,
      JSON.stringify({ v: 1, fetchedAt: 100, ttlMs: 1000, data: { posts: [] } }),
    );

    expect(readCacheEntry(store, keys, 500)).toBeNull();
    expect(store.removeItem).toHaveBeenCalledWith(keys.legacy);
  });

  it("persists and restores the complete response envelope", () => {
    const store = createStorage();
    const keys = buildCacheKeys("/posts", { method: "GET" });

    writeCacheEntry(store, keys.current, envelope, 1000, 100);

    expect(readCacheEntry(store, keys, 500)).toEqual({
      data: envelope,
      fetchedAt: 100,
      isFresh: true,
    });
  });

  it("treats malformed or raw v2 payloads as invalid", () => {
    const store = createStorage();
    const keys = buildCacheKeys("/posts", {});
    store.setItem(
      keys.current,
      JSON.stringify({ v: 2, fetchedAt: 100, ttlMs: 1000, data: { posts: [] } }),
    );

    expect(readCacheEntry(store, keys, 500)).toBeNull();
    expect(store.removeItem).toHaveBeenCalledWith(keys.current);
  });
});

describe("cached request coordination", () => {
  it("deduplicates concurrent requests for the same key", async () => {
    let resolveRequest;
    const factory = vi.fn(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );

    const first = runDedupedRequest("posts", factory);
    const second = runDedupedRequest("posts", factory);
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledOnce();

    resolveRequest(envelope);
    await expect(first).resolves.toEqual(envelope);

    const third = runDedupedRequest("posts", factory);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(third).not.toBe(first);
    resolveRequest(envelope);
    await third;
  });

  it("invalidates only standardized 404 failures", () => {
    expect(shouldInvalidateCache({ statusCode: 404 })).toBe(true);
    expect(shouldInvalidateCache({ statusCode: 503 })).toBe(false);
    expect(shouldInvalidateCache({ status: 404 })).toBe(false);
  });
});
