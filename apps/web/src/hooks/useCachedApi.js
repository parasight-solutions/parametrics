// apps/web/src/hooks/useCachedApi.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../apiClient";

function getStorage(kind) {
    return kind === "local" ? window.localStorage : window.sessionStorage;
}

function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
}

function stableStringify(v) {
    try { return JSON.stringify(v ?? null); } catch { return String(v); }
}

function now() {
    return Date.now();
}

/**
 * Stale-while-revalidate caching for `api()` calls.
 *
 * - Shows cached data instantly if available (even if stale)
 * - Refreshes in background on mount, interval, focus, and visibility change
 * - Aborts in-flight requests on key changes to avoid races
 */
export function useCachedApi(
    path,
    {
        enabled = true,
        ttlMs = 5 * 60 * 1000,
        refreshIntervalMs = 60 * 1000,
        storage = "session", // "session" | "local"
        apiOptions = {},     // forwarded into api(path, apiOptions)
    } = {}
) {
    const store = useMemo(() => getStorage(storage), [storage]);

    const key = useMemo(() => {
        if (!path) return null;
        const method = (apiOptions?.method || "GET").toUpperCase();
        const bodyKey = apiOptions?.body ? stableStringify(apiOptions.body) : "";
        return `cache:v1:${method}:${path}:${bodyKey}`;
    }, [path, apiOptions?.method, apiOptions?.body]);

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);       // only when no cache shown
    const [refreshing, setRefreshing] = useState(false); // background refresh
    const [error, setError] = useState(null);
    const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

    const abortRef = useRef(null);
    const inflightRef = useRef(null);
    const mountedRef = useRef(false);

    const readCache = useCallback(() => {
        if (!key) return null;
        const raw = store.getItem(key);
        if (!raw) return null;

        const parsed = safeJsonParse(raw);
        if (!parsed || parsed.v !== 1) return null;

        const fetchedAt = Number(parsed.fetchedAt || 0);
        const cachedTtl = Number(parsed.ttlMs || 0);
        const isFresh = fetchedAt && cachedTtl && (now() - fetchedAt) < cachedTtl;

        return {
            data: parsed.data ?? null,
            fetchedAt: fetchedAt || null,
            isFresh,
        };
    }, [key, store]);

    const writeCache = useCallback(
        (payload) => {
            if (!key) return;
            const fetchedAt = now();
            const entry = {
                v: 1,
                fetchedAt,
                ttlMs,
                data: payload ?? null,
            };
            try {
                store.setItem(key, JSON.stringify(entry));
            } catch {
                // ignore quota/serialization issues; app still works without cache
            }
            setLastUpdatedAt(fetchedAt);
        },
        [key, store, ttlMs]
    );

    const runFetch = useCallback(
        async ({ force = false } = {}) => {
            if (!enabled || !path || !key) return null;

            // If a request is already in-flight for THIS key, reuse it (dedupe)
            if (inflightRef.current?.key === key && inflightRef.current?.promise) {
                return inflightRef.current.promise;
            }

            // Abort any previous request
            try { abortRef.current?.abort?.(); } catch {
                // Abort is best-effort during request replacement.
            }
            const controller = new AbortController();
            abortRef.current = controller;

            const cached = readCache();
            const hasShownData = data != null || cached?.data != null;

            // Decide UX flags
            if (!hasShownData) setLoading(true);
            else setRefreshing(true);

            const p = (async () => {
                try {
                    // If not forcing and cache is fresh and we already have data shown, skip fetch
                    if (!force && cached?.isFresh && hasShownData) {
                        if (cached?.fetchedAt) setLastUpdatedAt(cached.fetchedAt);
                        return cached.data;
                    }

                    const out = await api(path, { ...apiOptions, signal: controller.signal });

                    setError(null);
                    setData(out);
                    writeCache(out);
                    return out;
                } catch (e) {
                    // Ignore aborts
                    if (e?.name === "AbortError") return null;

                    setError(e);
                    if (e?.status === 404) {
                        try { store.removeItem(key); } catch {
                            // Cache eviction failure should not keep stale UI data alive.
                        }
                        setData(null);
                        setLastUpdatedAt(null);
                    } else {
                        // If we have cache, keep showing it. Only clear if nothing exists.
                        const fallback = readCache();
                        if (!fallback?.data && data == null) setData(null);
                    }

                    throw e;
                } finally {
                    if (inflightRef.current?.key === key) inflightRef.current = null;
                    setLoading(false);
                    setRefreshing(false);
                }
            })();

            inflightRef.current = { key, promise: p };
            return p;
        },
        [enabled, path, key, apiOptions, readCache, writeCache, data, store]
    );

    // Initial load / key change: show cache immediately, then revalidate
    useEffect(() => {
        if (!enabled || !key) {
            setData(null);
            setError(null);
            setLastUpdatedAt(null);
            setLoading(false);
            setRefreshing(false);
            try { abortRef.current?.abort?.(); } catch {
                // Abort is best-effort when disabling the hook.
            }
            return;
        }

        mountedRef.current = true;

        const cached = readCache();
        if (cached?.data != null) {
            setData(cached.data);
            if (cached.fetchedAt) setLastUpdatedAt(cached.fetchedAt);
            setLoading(false);
        } else {
            setData(null);
        }

        // Always revalidate in background on mount/key change
        runFetch({ force: true }).catch(() => { });

        return () => {
            mountedRef.current = false;
            try { abortRef.current?.abort?.(); } catch {
                // Abort is best-effort during unmount/key changes.
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled]);

    // Background refresh: interval + focus + visibility change
    useEffect(() => {
        if (!enabled || !key || !refreshIntervalMs) return;

        const shouldRefresh = () => {
            if (document.visibilityState !== "visible") return false;
            if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
            return true;
        };

        const tick = () => {
            if (!shouldRefresh()) return;
            runFetch({ force: true }).catch(() => { });
        };

        const onFocus = () => tick();
        const onVis = () => tick();

        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVis);

        const t = setInterval(tick, refreshIntervalMs);

        return () => {
            clearInterval(t);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [enabled, key, refreshIntervalMs, runFetch]);

    const refresh = useCallback(() => runFetch({ force: true }), [runFetch]);

    return { data, loading, refreshing, error, lastUpdatedAt, refresh };
}
