const AUTH_EXPIRED_EVENT = "pm:auth-expired";

const isApplicationAuthFailure = (error) => {
  const status = error?.response?.status;
  const errors = error?.response?.data?.errors ?? [];
  const hasGoogleReauth = errors.some(
    (entry) =>
      entry?.code === "reauth_required" ||
      (entry?.details?.provider === "google" && entry?.details?.reason),
  );
  const code = String(errors[0]?.code ?? "").toLowerCase();
  const url = String(error?.config?.url ?? "").split("?")[0];

  return (
    status === 401 &&
    !hasGoogleReauth &&
    !url.endsWith("/auth/login") &&
    !url.endsWith("/auth/session") &&
    (code === "unauthorized" || code === "invalid")
  );
};

export { AUTH_EXPIRED_EVENT, isApplicationAuthFailure };
