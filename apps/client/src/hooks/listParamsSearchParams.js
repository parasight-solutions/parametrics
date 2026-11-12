const parseValue = (value, defaultValue) => {
  if (value === null || value === "") return defaultValue;

  if (typeof defaultValue === "number") {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : defaultValue;
  }

  if (typeof defaultValue === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    return defaultValue;
  }

  return value;
};

export const buildNextListParams = (
  currentParams,
  updates,
  { resetPage = false } = {},
) => ({
  ...currentParams,
  ...updates,
  ...(resetPage && { page: 1 }),
});

export const parseListSearchParams = (defaults, urlKeys, searchParams) => {
  const parsedParams = { ...defaults };

  urlKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) return;

    parsedParams[key] = parseValue(searchParams.get(key), defaults[key]);
  });

  return parsedParams;
};

export const serializeListSearchParams = (
  currentSearchParams,
  params,
  defaults,
  urlKeys,
) => {
  const nextSearchParams = new URLSearchParams(currentSearchParams);

  urlKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) return;

    const value = params[key];
    const shouldRemove =
      value === null ||
      value === undefined ||
      value === "" ||
      Object.is(value, defaults[key]);

    if (shouldRemove) {
      nextSearchParams.delete(key);
      return;
    }

    nextSearchParams.set(key, String(value));
  });

  return nextSearchParams;
};
