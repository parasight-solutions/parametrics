// apps/web/src/pages/OrganizationMembers.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import {
  MEMBER_CREATE_STATUSES,
  MEMBER_ROLES,
  MEMBER_STATUSES_ALL,
  createOrgMember,
  describeBackendError,
  disableOrgMember,
  formatAssignmentIds,
  formatDate,
  listOrgMembers,
  listOrganizations,
  parseAssignmentIdsInput,
  roleSupportsAssignments,
  updateOrgMember,
} from "../lib/memberManagement";

const emptyCreateForm = Object.freeze({
  user_id: "",
  role: "viewer",
  status: "active",
  assigned_client_ids_csv: "",
  assigned_location_ids_csv: "",
});

function roleBadge(role) {
  const r = String(role || "").toLowerCase();
  const cls =
    r === "owner"
      ? "bg-indigo-100 text-indigo-800"
      : r === "admin"
      ? "bg-purple-100 text-purple-800"
      : r === "manager"
      ? "bg-blue-100 text-blue-800"
      : r === "member"
      ? "bg-emerald-100 text-emerald-800"
      : r === "viewer"
      ? "bg-gray-100 text-gray-700"
      : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${cls}`}>
      {role || "-"}
    </span>
  );
}

function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  const cls =
    s === "active"
      ? "bg-green-100 text-green-700"
      : s === "invited"
      ? "bg-amber-100 text-amber-800"
      : s === "disabled"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${cls}`}>
      {status || "-"}
    </span>
  );
}

export default function OrganizationMembers({ onLogout }) {
  const [orgs, setOrgs] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsError, setOrgsError] = useState("");

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");

  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createBusy, setCreateBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState("");

  const [editingMemberId, setEditingMemberId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editMessage, setEditMessage] = useState("");

  const [disableBusyId, setDisableBusyId] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId) || null,
    [orgs, selectedOrgId],
  );

  const loadOrgs = useCallback(async () => {
    setOrgsLoading(true);
    setOrgsError("");
    try {
      const rows = await listOrganizations();
      setOrgs(rows);
      if (!rows.length) {
        setSelectedOrgId("");
      } else if (!rows.find((o) => o.id === selectedOrgId)) {
        setSelectedOrgId(rows[0].id);
      }
    } catch (err) {
      setOrgsError(describeBackendError(err));
    } finally {
      setOrgsLoading(false);
    }
  }, [selectedOrgId]);

  const loadMembers = useCallback(async (orgId) => {
    if (!orgId) {
      setMembers([]);
      return;
    }
    setMembersLoading(true);
    setMembersError("");
    try {
      const rows = await listOrgMembers(orgId);
      setMembers(rows);
    } catch (err) {
      setMembers([]);
      setMembersError(describeBackendError(err));
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedOrgId) loadMembers(selectedOrgId);
    else setMembers([]);
  }, [selectedOrgId, loadMembers]);

  function resetCreateForm() {
    setCreateForm(emptyCreateForm);
  }

  function startEdit(member) {
    setEditingMemberId(member.id || "");
    setEditForm({
      role: member.role || "viewer",
      status: member.status || "active",
      assigned_client_ids_csv: formatAssignmentIds(member.assigned_client_ids),
      assigned_location_ids_csv: formatAssignmentIds(member.assigned_location_ids),
    });
    setEditMessage("");
  }

  function cancelEdit() {
    setEditingMemberId("");
    setEditForm(null);
    setEditMessage("");
  }

  async function onCreateSubmit(event) {
    event.preventDefault();
    if (!selectedOrgId) return;
    if (!createForm.user_id.trim()) {
      setCreateMessage("user_id is required.");
      return;
    }
    setCreateBusy(true);
    setCreateMessage("");
    try {
      const body = {
        user_id: createForm.user_id.trim(),
        role: createForm.role,
        status: createForm.status,
      };
      if (roleSupportsAssignments(createForm.role)) {
        body.assigned_client_ids = parseAssignmentIdsInput(createForm.assigned_client_ids_csv);
        body.assigned_location_ids = parseAssignmentIdsInput(createForm.assigned_location_ids_csv);
      }
      const out = await createOrgMember(selectedOrgId, body);
      setCreateMessage(
        out?.created === false
          ? `Member already exists (returned unchanged: ${out?.member?.role}/${out?.member?.status}).`
          : "Member created.",
      );
      resetCreateForm();
      await loadMembers(selectedOrgId);
    } catch (err) {
      setCreateMessage(describeBackendError(err));
    } finally {
      setCreateBusy(false);
    }
  }

  async function onEditSubmit(event) {
    event.preventDefault();
    if (!selectedOrgId || !editingMemberId || !editForm) return;
    setEditBusy(true);
    setEditMessage("");
    try {
      const patch = {
        role: editForm.role,
        status: editForm.status,
      };
      if (roleSupportsAssignments(editForm.role)) {
        patch.assigned_client_ids = parseAssignmentIdsInput(editForm.assigned_client_ids_csv);
        patch.assigned_location_ids = parseAssignmentIdsInput(editForm.assigned_location_ids_csv);
      } else {
        patch.assigned_client_ids = [];
        patch.assigned_location_ids = [];
      }
      const out = await updateOrgMember(selectedOrgId, editingMemberId, patch);
      setEditMessage(out?.updated === false ? "No changes (already matches)." : "Member updated.");
      await loadMembers(selectedOrgId);
    } catch (err) {
      setEditMessage(describeBackendError(err));
    } finally {
      setEditBusy(false);
    }
  }

  async function onDisable(member) {
    if (!selectedOrgId || !member?.id) return;
    const ok = window.confirm(
      `Disable member ${member.user_id}? This sets status=disabled and does not delete the membership.`,
    );
    if (!ok) return;
    setDisableBusyId(member.id);
    setActionMessage("");
    try {
      const out = await disableOrgMember(selectedOrgId, member.id);
      setActionMessage(
        out?.disabled === false
          ? `Member ${member.user_id} was already disabled.`
          : `Member ${member.user_id} disabled.`,
      );
      if (editingMemberId === member.id) cancelEdit();
      await loadMembers(selectedOrgId);
    } catch (err) {
      setActionMessage(describeBackendError(err));
    } finally {
      setDisableBusyId("");
    }
  }

  return (
    <AppShell
      title="Organization Members"
      subtitle="Direct user_id-based workspace membership. Email invitations are not available yet."
      onLogout={onLogout}
    >
      <div className="space-y-6">
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <label htmlFor="org-select" className="block text-sm font-medium text-gray-700">
                Organization
              </label>
              <select
                id="org-select"
                value={selectedOrgId}
                onChange={(event) => setSelectedOrgId(event.target.value)}
                disabled={orgsLoading || !orgs.length}
                className="mt-1 w-full px-3 py-2 border rounded-lg disabled:opacity-60"
              >
                {!orgs.length ? (
                  <option value="">No organizations available</option>
                ) : (
                  orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name || o.id}
                    </option>
                  ))
                )}
              </select>
              {selectedOrg ? (
                <p className="mt-1 text-xs text-gray-500">id: {selectedOrg.id}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadOrgs}
                disabled={orgsLoading}
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                {orgsLoading ? "Loading…" : "Refresh orgs"}
              </button>
              <button
                type="button"
                onClick={() => selectedOrgId && loadMembers(selectedOrgId)}
                disabled={!selectedOrgId || membersLoading}
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                {membersLoading ? "Loading…" : "Refresh members"}
              </button>
            </div>
          </div>
          {orgsError ? (
            <div role="alert" className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-900">
              {orgsError}
            </div>
          ) : null}
        </div>

        <div className="bg-white border rounded-xl p-5 space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Add direct member</h2>
            <p className="text-xs text-gray-500">
              Direct membership by existing app user_id only. Backend role rules apply.
            </p>
          </div>
          <form onSubmit={onCreateSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="create-user-id" className="block text-sm font-medium text-gray-700">
                Target user_id
              </label>
              <input
                id="create-user-id"
                type="text"
                value={createForm.user_id}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, user_id: event.target.value }))
                }
                required
                autoComplete="off"
                className="mt-1 w-full px-3 py-2 border rounded-lg"
                placeholder="e.g. user_abc123"
              />
            </div>
            <div>
              <label htmlFor="create-role" className="block text-sm font-medium text-gray-700">
                Role
              </label>
              <select
                id="create-role"
                value={createForm.role}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, role: event.target.value }))
                }
                className="mt-1 w-full px-3 py-2 border rounded-lg"
              >
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="create-status" className="block text-sm font-medium text-gray-700">
                Status
              </label>
              <select
                id="create-status"
                value={createForm.status}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, status: event.target.value }))
                }
                className="mt-1 w-full px-3 py-2 border rounded-lg"
              >
                {MEMBER_CREATE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Direct create supports active or disabled only. Invited status requires an
                invitation flow that is not implemented yet.
              </p>
            </div>
            {roleSupportsAssignments(createForm.role) ? (
              <>
                <div>
                  <label htmlFor="create-clients" className="block text-sm font-medium text-gray-700">
                    Assigned client ids (comma separated)
                  </label>
                  <input
                    id="create-clients"
                    type="text"
                    value={createForm.assigned_client_ids_csv}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        assigned_client_ids_csv: event.target.value,
                      }))
                    }
                    autoComplete="off"
                    className="mt-1 w-full px-3 py-2 border rounded-lg"
                    placeholder="client_a, client_b"
                  />
                </div>
                <div>
                  <label htmlFor="create-locations" className="block text-sm font-medium text-gray-700">
                    Assigned location ids (comma separated)
                  </label>
                  <input
                    id="create-locations"
                    type="text"
                    value={createForm.assigned_location_ids_csv}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        assigned_location_ids_csv: event.target.value,
                      }))
                    }
                    autoComplete="off"
                    className="mt-1 w-full px-3 py-2 border rounded-lg"
                    placeholder="loc_a, loc_b"
                  />
                </div>
              </>
            ) : null}
            <div className="md:col-span-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={!selectedOrgId || createBusy}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"
              >
                {createBusy ? "Adding…" : "Add member"}
              </button>
              {createMessage ? (
                <span role="status" className="text-sm text-gray-700">
                  {createMessage}
                </span>
              ) : null}
            </div>
          </form>
        </div>

        <div className="bg-white border rounded-xl p-5 space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-xs text-gray-500">
              Sanitized rows only. Emails and raw user records are not displayed.
            </p>
          </div>

          {membersError ? (
            <div role="alert" className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-900">
              {membersError}
            </div>
          ) : null}
          {actionMessage ? (
            <div role="status" className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
              {actionMessage}
            </div>
          ) : null}

          {membersLoading ? (
            <div className="text-sm text-gray-600">Loading members…</div>
          ) : !selectedOrgId ? (
            <div className="text-sm text-gray-600">Select an organization above to list members.</div>
          ) : !members.length ? (
            <div className="text-sm text-gray-600">No members to show for this organization.</div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {members.map((m) => {
                const isEditing = editingMemberId === m.id;
                return (
                  <li key={m.id} className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium break-all">{m.user_id}</span>
                        {roleBadge(m.role)}
                        {statusBadge(m.status)}
                      </div>
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 rounded-lg border bg-white text-sm hover:bg-gray-100"
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(m)}
                            className="px-3 py-1.5 rounded-lg border bg-white text-sm hover:bg-gray-100"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDisable(m)}
                          disabled={disableBusyId === m.id || m.status === "disabled"}
                          className="px-3 py-1.5 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                        >
                          {disableBusyId === m.id ? "Disabling…" : "Disable"}
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 grid grid-cols-1 sm:grid-cols-2 gap-1">
                      <div>
                        <span className="font-medium text-gray-700">id:</span>{" "}
                        <span className="break-all font-mono">{m.id}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">created:</span>{" "}
                        {formatDate(m.created_at)}
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">updated:</span>{" "}
                        {formatDate(m.updated_at)}
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">assignments:</span>{" "}
                        clients {Array.isArray(m.assigned_client_ids) ? m.assigned_client_ids.length : 0}
                        {" · "}
                        locations {Array.isArray(m.assigned_location_ids) ? m.assigned_location_ids.length : 0}
                      </div>
                    </div>
                    {isEditing && editForm ? (
                      <form
                        onSubmit={onEditSubmit}
                        className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 rounded-lg border p-3"
                      >
                        <div>
                          <label
                            htmlFor={`edit-role-${m.id}`}
                            className="block text-sm font-medium text-gray-700"
                          >
                            Role
                          </label>
                          <select
                            id={`edit-role-${m.id}`}
                            value={editForm.role}
                            onChange={(event) =>
                              setEditForm((prev) => ({ ...prev, role: event.target.value }))
                            }
                            className="mt-1 w-full px-3 py-2 border rounded-lg"
                          >
                            {MEMBER_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`edit-status-${m.id}`}
                            className="block text-sm font-medium text-gray-700"
                          >
                            Status
                          </label>
                          <select
                            id={`edit-status-${m.id}`}
                            value={editForm.status}
                            onChange={(event) =>
                              setEditForm((prev) => ({ ...prev, status: event.target.value }))
                            }
                            className="mt-1 w-full px-3 py-2 border rounded-lg"
                          >
                            {MEMBER_STATUSES_ALL.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                        {roleSupportsAssignments(editForm.role) ? (
                          <>
                            <div>
                              <label
                                htmlFor={`edit-clients-${m.id}`}
                                className="block text-sm font-medium text-gray-700"
                              >
                                Assigned client ids (comma separated)
                              </label>
                              <input
                                id={`edit-clients-${m.id}`}
                                type="text"
                                value={editForm.assigned_client_ids_csv}
                                onChange={(event) =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    assigned_client_ids_csv: event.target.value,
                                  }))
                                }
                                autoComplete="off"
                                className="mt-1 w-full px-3 py-2 border rounded-lg"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`edit-locations-${m.id}`}
                                className="block text-sm font-medium text-gray-700"
                              >
                                Assigned location ids (comma separated)
                              </label>
                              <input
                                id={`edit-locations-${m.id}`}
                                type="text"
                                value={editForm.assigned_location_ids_csv}
                                onChange={(event) =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    assigned_location_ids_csv: event.target.value,
                                  }))
                                }
                                autoComplete="off"
                                className="mt-1 w-full px-3 py-2 border rounded-lg"
                              />
                            </div>
                          </>
                        ) : (
                          <div className="md:col-span-2 text-xs text-gray-600">
                            Assignments are not used for role {editForm.role}; existing assignments
                            will be cleared on save.
                          </div>
                        )}
                        <div className="md:col-span-2 flex items-center gap-3">
                          <button
                            type="submit"
                            disabled={editBusy}
                            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"
                          >
                            {editBusy ? "Saving…" : "Save changes"}
                          </button>
                          {editMessage ? (
                            <span role="status" className="text-sm text-gray-700">
                              {editMessage}
                            </span>
                          ) : null}
                        </div>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
