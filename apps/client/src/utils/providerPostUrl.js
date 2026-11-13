export function isProviderPostUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

export function openProviderPost(
  value,
  openWindow = globalThis.window?.open?.bind(globalThis.window),
) {
  if (!isProviderPostUrl(value) || typeof openWindow !== "function")
    return false;

  const url = value.trim();
  openWindow(url, "_blank", "noopener,noreferrer");
  return true;
}
