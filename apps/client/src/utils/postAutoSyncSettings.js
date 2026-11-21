export function deriveBulkAutoSyncState(locations = []) {
  const manageable = locations.filter((location) => location.canManage);
  if (!manageable.length) {
    return { checked: false, indeterminate: false, disabled: true };
  }
  const enabled = manageable.filter((location) => location.autoEnabled).length;
  return {
    checked: enabled === manageable.length,
    indeterminate: enabled > 0 && enabled < manageable.length,
    disabled: false,
  };
}

export function isCurrentSettingsScope(requested, current) {
  return (
    requested?.organizationId === current?.organizationId &&
    (requested?.integrationId || "") === (current?.integrationId || "")
  );
}

export function isCurrentSettingsRequest(requested, current) {
  return requested?.generation === current?.generation &&
    isCurrentSettingsScope(requested, current);
}

export function getPostAutoSyncErrorMessage(error) {
  return (
    error?.response?.data?.error?.message ||
    error?.message ||
    "Unable to update post auto-sync settings."
  );
}
