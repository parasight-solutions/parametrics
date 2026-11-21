import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import PageHeader from "../../components/ui/PageHeader";
import SelectDropdown from "../../components/ui/SelectDropdown";
import CustomCheckbox from "../../components/ui/CustomCheckbox";
import useApi from "../../hooks/useApi";
import { useNotify } from "../../context/notification/useNotify";
import { postSyncSettingsEndpoints } from "../../services/postSyncSettings.service";
import {
  deriveBulkAutoSyncState,
  getPostAutoSyncErrorMessage,
  isCurrentSettingsRequest,
} from "../../utils/postAutoSyncSettings";

const formatTimestamp = (value) =>
  value ? dayjs(value).format("DD MMM YYYY, hh:mm A") : "Not synchronized yet";

const PostAutoSyncSettings = () => {
  const { notify } = useNotify();
  const { loading, callApi } = useApi({ organizations: true });
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [integrationId, setIntegrationId] = useState("");
  const [locations, setLocations] = useState([]);
  const [intervalLabel, setIntervalLabel] = useState("Every 2 hours");
  const currentScopeRef = useRef({
    organizationId: "",
    integrationId: "",
    generation: 0,
  });
  const bulkCheckboxRef = useRef(null);

  const organizationOptions = useMemo(
    () =>
      organizations.map((organization) => ({
        value: organization.id,
        label: organization.name || organization.title || organization.id,
      })),
    [organizations],
  );
  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.integrationId,
        label: account.accountName || account.integrationId,
      })),
    [accounts],
  );
  const bulkState = useMemo(
    () => deriveBulkAutoSyncState(locations),
    [locations],
  );

  useEffect(() => {
    if (bulkCheckboxRef.current) {
      bulkCheckboxRef.current.indeterminate = bulkState.indeterminate;
    }
  }, [bulkState.indeterminate]);

  const fetchSettings = useCallback(
    (scope, { refreshAccounts = false, activate = true } = {}) => {
      if (!scope.organizationId) return;
      const request = activate
        ? { ...scope, generation: currentScopeRef.current.generation + 1 }
        : { ...scope, generation: currentScopeRef.current.generation };
      if (activate) currentScopeRef.current = request;
      setLocations([]);

      callApi("settings", () => postSyncSettingsEndpoints.getSettings(scope), {
        onSuccess: ({ data }) => {
          if (!isCurrentSettingsRequest(request, currentScopeRef.current))
            return;
          if (refreshAccounts) setAccounts(data?.accounts || []);
          setIntervalLabel(data?.intervalLabel || "Every 2 hours");
          setLocations(data?.locations || []);
        },
        onError: (error) => {
          if (!isCurrentSettingsRequest(request, currentScopeRef.current))
            return;
          notify.msgError(getPostAutoSyncErrorMessage(error));
        },
      });
    },
    [callApi, notify],
  );

  useEffect(() => {
    callApi("organizations", postSyncSettingsEndpoints.getOrganizations, {
      onSuccess: ({ data }) => {
        const rows = data?.orgs || [];
        setOrganizations(rows);
        if (rows[0]?.id) {
          setIntegrationId("");
          setAccounts([]);
          setOrganizationId(rows[0].id);
          fetchSettings(
            { organizationId: rows[0].id, integrationId: "" },
            { refreshAccounts: true },
          );
        }
      },
      onError: (error) => notify.msgError(getPostAutoSyncErrorMessage(error)),
    });
  }, [callApi, fetchSettings, notify]);

  const handleOrganizationChange = (value) => {
    setIntegrationId("");
    setAccounts([]);
    setOrganizationId(value);
    fetchSettings(
      { organizationId: value, integrationId: "" },
      { refreshAccounts: true },
    );
  };

  const handleAccountChange = (value) => {
    setIntegrationId(value);
    fetchSettings({ organizationId, integrationId: value });
  };

  const updateLocation = (location, enabled) => {
    const request = { ...currentScopeRef.current };
    callApi(
      `location-${location.id}`,
      () => postSyncSettingsEndpoints.updateLocation(location.id, enabled),
      {
        onSuccess: () => {
          if (!isCurrentSettingsRequest(request, currentScopeRef.current))
            return;
          notify.msgSuccess(
            `Auto-sync ${enabled ? "enabled" : "disabled"} for ${location.title}.`,
          );
          fetchSettings(request, { activate: false });
        },
        onError: (error) => {
          if (!isCurrentSettingsRequest(request, currentScopeRef.current))
            return;
          notify.msgError(getPostAutoSyncErrorMessage(error));
        },
      },
    );
  };

  const updateAll = (enabled) => {
    const request = { ...currentScopeRef.current };
    callApi(
      "bulkSaving",
      () =>
        postSyncSettingsEndpoints.updateScope({
          organizationId,
          integrationId,
          enabled,
        }),
      {
        onSuccess: () => {
          if (!isCurrentSettingsRequest(request, currentScopeRef.current))
            return;
          notify.msgSuccess(
            `Auto-sync ${enabled ? "enabled" : "disabled"} for all manageable locations.`,
          );
          fetchSettings(request, { activate: false });
        },
        onError: (error) => {
          if (!isCurrentSettingsRequest(request, currentScopeRef.current))
            return;
          notify.msgError(getPostAutoSyncErrorMessage(error));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading="Post Auto-Sync"
        subHeading="Manage automatic Google Business Profile post synchronization"
      />

      <div className="grid gap-4 rounded-xl border border-gray-300 p-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label
            className="text-sm font-medium"
            htmlFor="post-sync-organization"
          >
            Organization
          </label>
          <SelectDropdown
            id="post-sync-organization"
            options={organizationOptions}
            selectedOptions={organizationOptions.filter(
              (option) => option.value === organizationId,
            )}
            isSelected={(value) => value === organizationId}
            onSelect={handleOrganizationChange}
            placeholder="Select organization"
            loading={loading.organizations}
            disabled={loading.organizations}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="post-sync-account">
            Google account
          </label>
          <SelectDropdown
            id="post-sync-account"
            options={accountOptions}
            selectedOptions={accountOptions.filter(
              (option) => option.value === integrationId,
            )}
            isSelected={(value) => value === integrationId}
            onSelect={handleAccountChange}
            onClear={() => handleAccountChange("")}
            allowClear
            placeholder="All connected accounts"
            disabled={!organizationId || loading.settings}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-300 p-5">
        <div>
          <p className="font-medium">Enable Auto-Sync for All Locations</p>
          <p className="mt-1 text-xs text-gray-500">
            Synchronization interval: {intervalLabel}
          </p>
        </div>
        <CustomCheckbox
          ref={bulkCheckboxRef}
          aria-label="Enable auto-sync for all manageable locations"
          checked={bulkState.checked}
          disabled={
            bulkState.disabled || loading.bulkSaving || loading.settings
          }
          onChange={(event) => updateAll(event.target.checked)}
        />
      </div>

      <div className="flex flex-col gap-3">
        {loading.settings ? (
          <p className="text-sm text-gray-500">
            Loading post auto-sync settings...
          </p>
        ) : locations.length ? (
          locations.map((location) => (
            <div
              key={location.id}
              className="flex flex-col gap-4 rounded-xl border border-gray-300 p-5 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">{location.title}</p>
                <p className="mt-1 text-xs text-gray-500">{intervalLabel}</p>
                <p className="mt-1 text-xs text-gray-500">
                  Last successful sync:{" "}
                  {formatTimestamp(location.lastSuccessAt)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Status: {location.syncState || "disabled"}
                </p>
                {location.lastAutoFailureCode && (
                  <p className="mt-1 text-xs text-red-600">
                    {location.lastAutoFailureCode}
                  </p>
                )}
                {!location.canManage && (
                  <p className="mt-2 text-xs text-amber-700">
                    You can view this location but do not have permission to
                    change its auto-sync setting.
                  </p>
                )}
              </div>
              <CustomCheckbox
                aria-label={`Enable auto-sync for ${location.title}`}
                checked={location.autoEnabled}
                disabled={
                  !location.canManage ||
                  loading[`location-${location.id}`] ||
                  loading.bulkSaving
                }
                onChange={(event) =>
                  updateLocation(location, event.target.checked)
                }
              />
            </div>
          ))
        ) : (
          <p className="text-sm text-gray-500">
            No authorized Google Business Profile locations are available for
            this scope.
          </p>
        )}
      </div>
    </div>
  );
};

export default PostAutoSyncSettings;
