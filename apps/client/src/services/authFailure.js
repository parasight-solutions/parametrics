const AUTH_EXPIRED_EVENT = "pm:auth-expired";

const isApplicationAuthFailure = (error) => {
  const status = error?.response?.status;
  const code = String(
    error?.response?.data?.error?.code ?? error?.response?.data?.code ?? "",
  ).toLowerCase();
  const authorization = error?.config?.headers?.Authorization;

  return (
    status === 401 &&
    Boolean(authorization) &&
    (code === "unauthorized" || code === "invalid")
  );
};

export { AUTH_EXPIRED_EVENT, isApplicationAuthFailure };
