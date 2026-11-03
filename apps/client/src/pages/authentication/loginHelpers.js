export function getPostLoginPath(from) {
  const pathname = from?.pathname;

  if (
    typeof pathname !== "string" ||
    !pathname.startsWith("/") ||
    pathname.startsWith("//")
  ) {
    return "/";
  }

  return `${pathname}${from?.search ?? ""}${from?.hash ?? ""}`;
}

export function getLoginErrorMessage(error) {
  const backendError = error?.response?.data?.error;

  if (typeof backendError?.message === "string" && backendError.message) {
    return backendError.message;
  }

  if (backendError?.code === "invalid") {
    return "Invalid email or password.";
  }

  return "Unable to sign in. Please try again.";
}
