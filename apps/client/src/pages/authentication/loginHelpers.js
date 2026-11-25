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
  const backendError = error?.errors?.[0];

  if (backendError?.code === "invalid") {
    return "Invalid email or password.";
  }

  if (
    Number.isInteger(error?.statusCode) &&
    typeof error?.message === "string" &&
    error.message
  ) {
    return error.message;
  }

  if (
    Number.isInteger(error?.statusCode) &&
    typeof backendError?.message === "string" &&
    backendError.message
  ) {
    return backendError.message;
  }

  return "Unable to sign in. Please try again.";
}
