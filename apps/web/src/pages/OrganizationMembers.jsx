// apps/web/src/pages/OrganizationMembers.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import {
  MEMBER_CANDIDATE_MIN_SEARCH,
  MEMBER_CREATE_STATUSES,
  MEMBER_ROLES,
  MEMBER_STATUSES_ALL,
  buildCreateMemberPayload,
  buildDisableConfirmMessage,
  canSubmitMemberCreate,
  clearSelectedCandidate,
  createOrgMember,
  describeBackendError,
  disableOrgMember,
  editCandidateQuery,
  editManualUserId,
  formatAssignmentIds,
  formatDate,
  initialAddSelection,
  listOrgMembers,
  listOrganizations,
  buildMemberAddedMessage,
  memberDisplayLabel,
  parseAssignmentIdsInput,
  roleSupportsAssignments,
  searchMemberCandidates,
  selectCandidateForAdd,
  toggleManualUserIdMode,
  updateOrgMember,
} from "../lib/memberManagement";

const ASSIGNMENT_HELP =
  "Leave blank unless this member should only access specific clients or locations.";
const NO_ASSIGNMENT_NEEDED =
  "Owner, admin, and member roles do not need client or location assignments.";
const BTN_BASE =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY = `${BTN_BASE} px-4 bg-gray-900 text-white hover:bg-black`;
const BTN_SECONDARY = `${BTN_BASE} px-3 border bg-white text-gray-800 hover:bg-gray-100`;
const BTN_SMALL = BTN_SECONDARY;
const INPUT = "h-10 w-full px-3 border rounded-lg";

function StepHeading({ n, title, hint }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
        {n}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {hint ? <p className="text-xs text-gray-500">{hint}</p> : null}
      </div>
    </div>
  );
}

const emptyCreateForm = Object.freeze({
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

  const [addSelection, setAddSelection] = useState(initialAddSelection);
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState("");
  const [candidatesSearched, setCandidatesSearched] = useState(false);

  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

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

  function resetCandidateSearch() {
    setAddSelection(initialAddSelection);
    setCandidates([]);
    setCandidatesError("");
    setCandidatesSearched(false);
  }

  function clearCreateMessages() {
    setCreateError("");
    setCreateSuccess("");
  }

  useEffect(() => {
    loadOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedOrgId) loadMembers(selectedOrgId);
    else setMembers([]);
    resetCandidateSearch();
    setCreateForm(emptyCreateForm);
    clearCreateMessages();
    setActionMessage("");
  }, [selectedOrgId, loadMembers]);

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

  async function onCandidateSearch(event) {
    event.preventDefault();
    if (!selectedOrgId) return;
    const term = addSelection.query.trim();
    clearCreateMessages();
    setAddSelection((prev) => clearSelectedCandidate(prev));
    if (!term) {
      setCandidatesError("Enter a name, email, or user id to search.");
      return;
    }
    setCandidatesLoading(true);
    setCandidatesError("");
    setCandidatesSearched(true);
    try {
      const rows = await searchMemberCandidates(selectedOrgId, term);
      setCandidates(rows);
    } catch (err) {
      setCandidates([]);
      setCandidatesError(describeBackendError(err));
    } finally {
      setCandidatesLoading(false);
    }
  }

  function selectCandidate(candidate) {
    clearCreateMessages();
    setAddSelection((prev) => selectCandidateForAdd(prev, candidate));
  }

  async function onCreateSubmit(event) {
    event.preventDefault();
    clearCreateMessages();
    if (!canSubmitMemberCreate(addSelection, { orgId: selectedOrgId, busy: createBusy })) {
      setCreateError(
        "Select a user from the search results first (or use Advanced manual entry).",
      );
      return;
    }
    const body = buildCreateMemberPayload(addSelection, createForm);
    if (!body) return;
    const label = addSelection.manualMode
      ? `User ${body.user_id}`
      : addSelection.selectedCandidate?.display_name || `User ${body.user_id}`;
    setCreateBusy(true);
    try {
      const out = await createOrgMember(selectedOrgId, body);
      if (out?.created === false) {
        setCreateSuccess(
          `${label} is already a member (${out?.member?.role || "-"}/${out?.member?.status || "-"}). No changes made.`,
        );
      } else if (out?.member) {
        setCreateSuccess(buildMemberAddedMessage({ name: label, role: out.member.role || body.role }));
      } else {
        setCreateError("Unexpected response from server; member list refreshed.");
      }
      setCreateForm(emptyCreateForm);
      resetCandidateSearch();
      await loadMembers(selectedOrgId);
    } catch (err) {
      setCreateError(describeBackendError(err));
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
    if (member.status === "disabled") return;
    const label = memberDisplayLabel(member);
    const ok = window.confirm(buildDisableConfirmMessage(member));
    if (!ok) return;
    setDisableBusyId(member.id);
    setActionMessage("");
    try {
      const out = await disableOrgMember(selectedOrgId, member.id);
      setActionMessage(
        out?.disabled === false
          ? `Member ${label} was already disabled.`
          : `Member ${label} disabled.`,
      );
      if (editingMemberId === member.id) cancelEdit();
      await loadMembers(selectedOrgId);
    } catch (err) {
      setActionMessage(describeBackendError(err));
    } finally {
      setDisableBusyId("");
    }
  }

  const createCanSubmit = canSubmitMemberCreate(addSelection, {
    orgId: selectedOrgId,
    busy: createBusy,
  });
  const selectedCandidate = addSelection.selectedCandidate;

  return (
    <AppShell
      title="Organization Members"
      subtitle="Search for an existing user to add them to this workspace. Email invitations are not available yet."
      onLogout={onLogout}
    >
      <div className="space-y-6">
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <div className="space-y-1">
            <label htmlFor="org-select" className="block text-sm font-medium text-gray-700">
              Organization
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                id="org-select"
                value={selectedOrgId}
                onChange={(event) => setSelectedOrgId(event.target.value)}
                disabled={orgsLoading || !orgs.length}
                className={`${INPUT} bg-white sm:flex-1 min-w-0 disabled:opacity-60`}
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadOrgs}
                  disabled={orgsLoading}
                  className={BTN_SECONDARY}
                >
                  {orgsLoading ? "Loading…" : "Refresh orgs"}
                </button>
                <button
                  type="button"
                  onClick={() => selectedOrgId && loadMembers(selectedOrgId)}
                  disabled={!selectedOrgId || membersLoading}
                  className={BTN_SECONDARY}
                >
                  {membersLoading ? "Loading…" : "Refresh members"}
                </button>
              </div>
            </div>
            {selectedOrg ? (
              <p className="text-[11px] text-gray-400">
                Organization ID (technical): <span className="font-mono">{selectedOrg.id}</span>
              </p>
            ) : null}
          </div>
          {orgsError ? (
            <div role="alert" className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-900">
              {orgsError}
            </div>
          ) : null}
        </div>

        <div className="bg-white border rounded-xl p-5 space-y-5" data-testid="add-member-card">
          <div>
            <h2 className="text-lg font-semibold">Add a member</h2>
            <p className="text-sm text-gray-500">
              Add someone who already has a ParaMetrics account. Owners and admins only.
            </p>
          </div>

          <section className="space-y-2" data-testid="add-step-1">
            <StepHeading
              n={1}
              title="Search existing user"
              hint={`Search by name or email (at least ${MEMBER_CANDIDATE_MIN_SEARCH} characters).`}
            />
            <form onSubmit={onCandidateSearch} className="flex items-center gap-2 sm:pl-9">
              <label htmlFor="candidate-search" className="sr-only">
                Search existing user
              </label>
              <input
                id="candidate-search"
                type="text"
                value={addSelection.query}
                onChange={(event) => {
                  const value = event.target.value;
                  setAddSelection((prev) => editCandidateQuery(prev, value));
                  clearCreateMessages();
                }}
                autoComplete="off"
                className={`${INPUT} flex-1 min-w-0`}
                placeholder="e.g. Jane or jane@company.com"
              />
              <button
                type="submit"
                disabled={!selectedOrgId || candidatesLoading}
                className={BTN_PRIMARY}
                data-testid="candidate-search-submit"
              >
                {candidatesLoading ? "Searching…" : "Search"}
              </button>
            </form>
            {candidatesError ? (
              <div
                role="alert"
                data-testid="candidate-search-error"
                className="sm:ml-9 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                Search failed: {candidatesError}
              </div>
            ) : null}
          </section>

          <section className="space-y-2" data-testid="add-step-2">
            <StepHeading n={2} title="Select user" hint="Click a person in the results to select them." />
            <div className="sm:pl-9 space-y-2">
              {candidatesLoading ? (
                <div className="text-sm text-gray-600">Searching users…</div>
              ) : candidatesSearched && !candidates.length && !candidatesError ? (
                <div
                  data-testid="candidate-empty"
                  className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600"
                >
                  No matching users found. The person must sign in to ParaMetrics at least once before
                  they can be added.
                </div>
              ) : candidates.length ? (
                <ul className="space-y-2" data-testid="candidate-results">
                  {candidates.map((candidate) => {
                    const isSelected = selectedCandidate?.user_id === candidate.user_id;
                    const unavailable = candidate.already_member;
                    return (
                      <li key={candidate.user_id}>
                        <button
                          type="button"
                          data-testid="candidate-row"
                          aria-pressed={isSelected}
                          disabled={unavailable}
                          onClick={() => selectCandidate(candidate)}
                          className={`w-full rounded-lg border p-3 text-left flex items-center justify-between gap-3 transition ${
                            unavailable
                              ? "bg-gray-50 opacity-60 cursor-not-allowed"
                              : isSelected
                              ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                              : "bg-white hover:border-gray-400 hover:bg-gray-50 cursor-pointer"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium break-all">
                              {candidate.display_name}
                            </span>
                            {candidate.email_masked ? (
                              <span className="block text-xs text-gray-600 break-all">
                                {candidate.email_masked}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                              unavailable
                                ? "bg-gray-200 text-gray-700"
                                : isSelected
                                ? "bg-blue-600 text-white"
                                : "border bg-white text-gray-700"
                            }`}
                          >
                            {unavailable
                              ? `Already a member${candidate.membership_role ? ` · ${candidate.membership_role}` : ""}`
                              : isSelected
                              ? "Selected"
                              : "Select"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">Search above to see matching people.</div>
              )}

              {!addSelection.manualMode && selectedCandidate ? (
                <div
                  data-testid="selected-candidate"
                  className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3"
                >
                  <div className="min-w-0 text-sm">
                    <span className="text-gray-600">Selected: </span>
                    <span className="font-medium break-all">{selectedCandidate.display_name}</span>
                    {selectedCandidate.email_masked ? (
                      <span className="text-gray-600 break-all"> · {selectedCandidate.email_masked}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddSelection((prev) => clearSelectedCandidate(prev))}
                    className={BTN_SMALL}
                  >
                    Clear
                  </button>
                </div>
              ) : null}

              <div className="rounded-lg border border-dashed">
                <button
                  type="button"
                  data-testid="advanced-manual-toggle"
                  aria-expanded={addSelection.manualMode}
                  onClick={() => {
                    clearCreateMessages();
                    setAddSelection((prev) => toggleManualUserIdMode(prev));
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-gray-600 hover:text-gray-900"
                >
                  {addSelection.manualMode ? "▾" : "▸"} Advanced: enter user_id manually
                </button>
                {addSelection.manualMode ? (
                  <div className="border-t bg-amber-50 p-3 space-y-1" data-testid="advanced-manual-panel">
                    <label htmlFor="create-user-id" className="block text-sm font-medium text-gray-700">
                      Exact user_id
                    </label>
                    <input
                      id="create-user-id"
                      type="text"
                      value={addSelection.manualUserId}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAddSelection((prev) => editManualUserId(prev, value));
                      }}
                      autoComplete="off"
                      className={`${INPUT} bg-white font-mono text-sm`}
                      placeholder="exact existing app user_id"
                    />
                    <p className="text-xs text-amber-900">
                      Use only if you know the exact existing app user_id. The server checks that this
                      user exists and is active; unknown ids are rejected.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <form onSubmit={onCreateSubmit} className="space-y-5">
            <section className="space-y-2" data-testid="add-step-3">
              <StepHeading n={3} title="Choose role" />
              <div className="sm:pl-9 grid grid-cols-1 md:grid-cols-2 gap-3">
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
                    className={`mt-1 ${INPUT} bg-white`}
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
                    className={`mt-1 ${INPUT} bg-white`}
                  >
                    {MEMBER_CREATE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {roleSupportsAssignments(createForm.role) ? (
                  <fieldset
                    data-testid="advanced-scope"
                    className="md:col-span-2 rounded-lg border bg-gray-50 p-3 space-y-3"
                  >
                    <legend className="px-1 text-sm font-medium text-gray-700">
                      Optional advanced scope
                    </legend>
                    <p className="text-xs text-gray-600">{ASSIGNMENT_HELP}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="create-clients" className="block text-sm font-medium text-gray-700">
                          Client IDs (comma separated)
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
                          className={`mt-1 ${INPUT} bg-white`}
                          placeholder="Leave blank for full access"
                        />
                      </div>
                      <div>
                        <label htmlFor="create-locations" className="block text-sm font-medium text-gray-700">
                          Location IDs (comma separated)
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
                          className={`mt-1 ${INPUT} bg-white`}
                          placeholder="Leave blank for full access"
                        />
                      </div>
                    </div>
                  </fieldset>
                ) : (
                  <p data-testid="scope-not-needed" className="md:col-span-2 text-xs text-gray-500">
                    {NO_ASSIGNMENT_NEEDED}
                  </p>
                )}
              </div>
            </section>

            <section className="space-y-2" data-testid="add-step-4">
              <StepHeading n={4} title="Add member" />
              <div className="sm:pl-9 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={!createCanSubmit}
                    className={BTN_PRIMARY}
                    data-testid="add-member-submit"
                  >
                    {createBusy ? "Adding…" : "Add member"}
                  </button>
                  <span className="text-sm text-gray-600" data-testid="add-member-hint">
                    {createCanSubmit
                      ? `Adds ${
                          addSelection.manualMode
                            ? "the entered user_id"
                            : selectedCandidate?.display_name || "the selected user"
                        } as ${createForm.role}.`
                      : selectedCandidate?.already_member
                      ? "This person is already a member. Edit them in the list below."
                      : addSelection.manualMode
                      ? "Enter an exact user_id to enable Add member."
                      : "Select a user in step 2 to enable Add member."}
                  </span>
                </div>
                {createError ? (
                  <div
                    role="alert"
                    data-testid="create-error"
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    Not added: {createError}
                  </div>
                ) : null}
                {createSuccess ? (
                  <div
                    role="status"
                    data-testid="create-success"
                    className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
                  >
                    {createSuccess}
                  </div>
                ) : null}
              </div>
            </section>
          </form>
        </div>

        <div className="bg-white border rounded-xl p-5 space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-xs text-gray-500">
              Names and masked emails only. Raw emails and raw user records are not displayed.
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
            <ul className="divide-y rounded-lg border" data-testid="member-list">
              {members.map((m) => {
                const isEditing = editingMemberId === m.id;
                return (
                  <li key={m.id} className="p-3 space-y-2" data-testid="member-row">
                    <div className="flex flex-wrap items-start gap-3 justify-between">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold break-all" data-testid="member-name">
                            {memberDisplayLabel(m)}
                          </span>
                          {roleBadge(m.role)}
                          {statusBadge(m.status)}
                        </div>
                        {m.email_masked ? (
                          <div className="text-xs text-gray-600 break-all" data-testid="member-email">
                            {m.email_masked}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">No profile email on file</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <button type="button" onClick={cancelEdit} className={BTN_SMALL}>
                            Cancel
                          </button>
                        ) : (
                          <button type="button" onClick={() => startEdit(m)} className={BTN_SMALL}>
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDisable(m)}
                          disabled={disableBusyId === m.id || m.status === "disabled"}
                          title={m.status === "disabled" ? "Already disabled" : "Disable this membership"}
                          data-testid="member-disable"
                          className={`${BTN_SMALL} ${m.status === "disabled" ? "text-gray-500" : "text-red-700"}`}
                        >
                          {disableBusyId === m.id
                            ? "Disabling…"
                            : m.status === "disabled"
                            ? "Disabled"
                            : "Disable"}
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Added: {formatDate(m.created_at)}</span>
                      <span>Updated: {formatDate(m.updated_at)}</span>
                      <span>
                        Scope: clients {Array.isArray(m.assigned_client_ids) ? m.assigned_client_ids.length : 0}
                        {" · "}
                        locations {Array.isArray(m.assigned_location_ids) ? m.assigned_location_ids.length : 0}
                      </span>
                    </div>
                    <details className="text-[11px] text-gray-400" data-testid="member-tech-details">
                      <summary className="cursor-pointer select-none hover:text-gray-600">
                        Technical details
                      </summary>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          User ID: <span className="font-mono break-all">{m.user_id}</span>
                        </span>
                        <span>
                          Membership ID: <span className="font-mono break-all">{m.id}</span>
                        </span>
                      </div>
                    </details>
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
                            className={`mt-1 ${INPUT} bg-white`}
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
                            className={`mt-1 ${INPUT} bg-white`}
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
                            <p className="md:col-span-2 text-xs text-gray-600">
                              <span className="font-medium text-gray-700">Optional advanced scope.</span>{" "}
                              {ASSIGNMENT_HELP}
                            </p>
                            <div>
                              <label
                                htmlFor={`edit-clients-${m.id}`}
                                className="block text-sm font-medium text-gray-700"
                              >
                                Client IDs (comma separated)
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
                                className={`mt-1 ${INPUT} bg-white`}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`edit-locations-${m.id}`}
                                className="block text-sm font-medium text-gray-700"
                              >
                                Location IDs (comma separated)
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
                                className={`mt-1 ${INPUT} bg-white`}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="md:col-span-2 text-xs text-gray-600">
                            {NO_ASSIGNMENT_NEEDED} Any existing assignments are cleared on save.
                          </div>
                        )}
                        <div className="md:col-span-2 flex items-center gap-3">
                          <button
                            type="submit"
                            disabled={editBusy}
                            className={BTN_PRIMARY}
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
