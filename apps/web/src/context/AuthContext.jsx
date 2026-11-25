import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, AUTH_EXPIRED_EVENT } from "../apiClient";
import { clearAuthSession, clearLegacyAuthStorage } from "../session";
import { createAuthOperationTracker } from "./authOperations";
import { restoreAuthenticatedUser } from "./authState";
import { AuthContext } from "./useAuth";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const operationsRef = useRef(createAuthOperationTracker());
  const logoutRequestRef = useRef(null);
  const mountedRef = useRef(false);

  const canApply = useCallback(
    (generation) =>
      mountedRef.current && operationsRef.current.isCurrent(generation),
    [],
  );

  const beginLogin = useCallback(() => {
    const generation = operationsRef.current.begin();
    logoutRequestRef.current = null;
    setLogoutError("");
    setLogoutLoading(false);
    return generation;
  }, []);

  const login = useCallback(
    (authenticatedUser, startedGeneration) => {
      const generation = startedGeneration ?? operationsRef.current.begin();
      if (!canApply(generation)) return false;
      logoutRequestRef.current = null;
      clearAuthSession();
      setLogoutError("");
      setLogoutLoading(false);
      setUser(authenticatedUser);
      return true;
    },
    [canApply],
  );

  const clearLogoutError = useCallback(() => setLogoutError(""), []);

  const logout = useCallback(() => {
    if (logoutRequestRef.current) return logoutRequestRef.current;

    const generation = operationsRef.current.begin();
    setLogoutLoading(true);
    setLogoutError("");

    const request = api("/auth/logout", { method: "POST", auth: false })
      .then((result) => {
        if (result !== null) {
          if (canApply(generation)) {
            setLogoutError("Logout failed. Please try again.");
          }
          return false;
        }
        if (!operationsRef.current.isCurrent(generation)) return false;
        clearAuthSession();
        if (mountedRef.current) setUser(null);
        return true;
      })
      .catch(() => {
        if (canApply(generation)) {
          setLogoutError("Logout failed. Please try again.");
        }
        return false;
      })
      .finally(() => {
        if (canApply(generation)) setLogoutLoading(false);
        if (logoutRequestRef.current === request) {
          logoutRequestRef.current = null;
        }
      });

    logoutRequestRef.current = request;
    return request;
  }, [canApply]);

  const restoreSession = useCallback(async () => {
    const generation = operationsRef.current.begin();
    clearLegacyAuthStorage();
    try {
      const restoredUser = await restoreAuthenticatedUser(() =>
        api("/auth/session", { auth: false }),
      );
      if (canApply(generation)) setUser(restoredUser);
      return restoredUser;
    } catch (error) {
      if (canApply(generation)) setUser(null);
      throw error;
    } finally {
      if (canApply(generation)) setAuthLoading(false);
    }
  }, [canApply]);

  useEffect(() => {
    mountedRef.current = true;
    restoreSession().catch((error) => {
      console.error("[auth] session restoration failed", error);
    });
    return () => {
      mountedRef.current = false;
    };
  }, [restoreSession]);

  useEffect(() => {
    const expire = () => {
      operationsRef.current.invalidate();
      logoutRequestRef.current = null;
      clearAuthSession();
      setLogoutLoading(false);
      setLogoutError("");
      setUser(null);
    };
    globalThis.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => globalThis.removeEventListener(AUTH_EXPIRED_EVENT, expire);
  }, []);

  const value = useMemo(
    () => ({
      user,
      authLoading,
      isAuthenticated: Boolean(user),
      login,
      beginLogin,
      logout,
      logoutLoading,
      logoutError,
      clearLogoutError,
      restoreSession,
    }),
    [
      authLoading,
      beginLogin,
      clearLogoutError,
      login,
      logout,
      logoutError,
      logoutLoading,
      restoreSession,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
