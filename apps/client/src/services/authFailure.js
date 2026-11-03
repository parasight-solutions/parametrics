const AUTH_EXPIRED_EVENT = "pm:auth-expired";

const isApplicationAuthFailure = (error) => {
  const status = error?.response?.status;
  const code = String(
    error?.response?.data?.error?.code ?? error?.response?.data?.code ?? "",
  ).toLowerCase();
  const url = String(error?.config?.url ?? "");

  return (
    status === 401 &&
    !url.endsWith("/auth/login") &&
    !url.endsWith("/auth/session") &&
    (code === "unauthorized" || code === "invalid")
  );
};

export { AUTH_EXPIRED_EVENT, isApplicationAuthFailure };
