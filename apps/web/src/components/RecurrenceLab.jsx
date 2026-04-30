// apps/web/src/components/RecurrenceLab.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import ActiveLocationPicker from "./ActiveLocationPicker";
import { getActiveLocationId } from "../session";

function authHeaders() {
  const t =
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    sessionStorage.getItem("token") ||
    "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(opts.headers || {}),
    },
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.message || "Request failed");
  return data;
}

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

const INDUSTRIES = [
  "Digital Marketing Agency",
  "Video Production",
  "Training / Education",
  "Real Estate",
  "Salon / Beauty",
  "Clinic / Healthcare",
  "Restaurant / Cafe",
  "E-commerce",
  "Fitness / Gym",
  "Legal / Consulting",
  "Travel / Tourism",
  "Automotive",
  "Home Services",
  "Software / IT Services",
  "Other",
];

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "Custom",
];

function parseCsv(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function RecurrenceLab({ locationId: locationIdProp, onLocationChange }) {
  const [localLocationId, setLocalLocationId] = useState(getActiveLocationId());
  const locationId = locationIdProp ?? localLocationId;
  const setLocationId = onLocationChange ?? setLocalLocationId;

  const [open, setOpen] = useState(false);
  const canUse = useMemo(() => !!locationId, [locationId]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Data
  const [orgs, setOrgs] = useState([]);
  const [binding, setBinding] = useState({ map: null, org: null }); // from /location-org
  const [rule, setRule] = useState(null);
  const [posts, setPosts] = useState([]);

  // UI state
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [showOrgAdvanced, setShowOrgAdvanced] = useState(false);
  const firstOpenLoadedRef = useRef(false);

  // Org form (simple + clear)
  const [orgForm, setOrgForm] = useState({
    name: "",
    website: "",
    industry: "Digital Marketing Agency",
    industryOther: "",
    description: "",
    servicesCsv: "",
    keywordsCsv: "",
    tone: "",
    offers: "",
    doNotMention: "",
    goalsCsv: "",
    language: "en",
  });

  const [ruleForm, setRuleForm] = useState({
    enabled: false,
    mode: "manual",
    frequency: "weekly",
    count: 3,
    timezoneChoice: "Asia/Kolkata",
    timezoneCustom: "",
    windowStart: "10:00",
    windowEnd: "18:00",
    template: { summary: "Write a post relevant to this location and our services. Keep it clean and professional." },
    ai_image_enabled: false,
  });

  const timezoneValue =
    ruleForm.timezoneChoice === "Custom"
      ? (ruleForm.timezoneCustom || "").trim()
      : ruleForm.timezoneChoice;

  async function loadAll() {
    if (!locationId) return;
    setErr("");

    const [o, b, r, p] = await Promise.all([
      api("/api/v1/orgs"),
      api(`/api/v1/location-org?locationId=${encodeURIComponent(locationId)}`),
      api(`/api/v1/recurrence?locationId=${encodeURIComponent(locationId)}`),
      api(`/api/v1/recurrence/posts?locationId=${encodeURIComponent(locationId)}`),
    ]);

    setOrgs(o.orgs || []);
    setBinding({ map: b.map || null, org: b.org || null });

    setRule(r.rule || null);
    if (r.rule) {
      setRuleForm((x) => {
        const tz = r.rule.timezone || "Asia/Kolkata";
        const tzChoice = TIMEZONES.includes(tz) ? tz : "Custom";
        return {
          ...x,
          enabled: !!r.rule.enabled,
          mode: r.rule.mode || x.mode,
          frequency: r.rule.frequency || x.frequency,
          count: r.rule.count ?? x.count,
          timezoneChoice: tzChoice,
          timezoneCustom: tzChoice === "Custom" ? tz : "",
          windowStart: r.rule.window_start || x.windowStart,
          windowEnd: r.rule.window_end || x.windowEnd,
          template: { summary: r.rule.template_summary || x.template.summary },
          ai_image_enabled: !!r.rule.ai_image_enabled,
        };
      });
    }

    setPosts(p.posts || []);

    // If there is a bound org, auto-select it in dropdown
    if (b?.org?.id) setSelectedOrgId(b.org.id);
  }

  // Load when drawer opens
  useEffect(() => {
    if (!open) return;
    if (!locationId) return;

    loadAll()
      .then(() => {
        firstOpenLoadedRef.current = true;
      })
      .catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locationId]);

  // ESC closes drawer
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function bindOrg(orgId) {
    if (!locationId) return;
    if (!orgId) throw new Error("Pick an org to bind.");

    await api(`/api/v1/location-org?locationId=${encodeURIComponent(locationId)}`, {
      method: "PUT",
      body: JSON.stringify({ orgId }),
    });
  }

  async function saveNewOrgAndBind() {
    if (!locationId) return;
    setBusy(true);
    setErr("");
    try {
      const industryFinal =
        orgForm.industry === "Other" ? (orgForm.industryOther || "").trim() : orgForm.industry;

      const payload = {
        name: orgForm.name.trim(),
        website: orgForm.website.trim(),
        industry: industryFinal,
        description: orgForm.description.trim(),
        onboarding: {
          services: parseCsv(orgForm.servicesCsv),
          keywords: parseCsv(orgForm.keywordsCsv),
          tone: orgForm.tone.trim(),
          offers: orgForm.offers.trim(),
          doNotMention: orgForm.doNotMention.trim(),
          goals: parseCsv(orgForm.goalsCsv),
          language: (orgForm.language || "en").trim(),
        },
      };

      const out = await api("/api/v1/orgs", { method: "POST", body: JSON.stringify(payload) });
      const newOrgId = out?.org?.id;
      if (!newOrgId) throw new Error("Org create failed (missing org.id)");

      await bindOrg(newOrgId);
      setSelectedOrgId(newOrgId);

      await loadAll();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function bindSelectedOrg() {
    setBusy(true);
    setErr("");
    try {
      await bindOrg(selectedOrgId);
      await loadAll();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveRule() {
    if (!locationId) return;
    setBusy(true);
    setErr("");
    try {
      const payload = {
        enabled: !!ruleForm.enabled,
        mode: ruleForm.mode,
        frequency: ruleForm.frequency,
        count: Number(ruleForm.count || 1),
        timezone: timezoneValue || "Asia/Kolkata",
        windowStart: ruleForm.windowStart,
        windowEnd: ruleForm.windowEnd,
        template: { summary: ruleForm.template?.summary || "" },
        ai_image_enabled: !!ruleForm.ai_image_enabled,
      };

      await api(`/api/v1/recurrence?locationId=${encodeURIComponent(locationId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      await loadAll();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function planNow() {
    if (!locationId) return;
    setBusy(true);
    setErr("");
    try {
      const out = await api(`/api/v1/recurrence/plan-now?locationId=${encodeURIComponent(locationId)}`, {
        method: "POST",
      });

      await loadAll();

      // quick UX feedback
      const planned = out?.planned ?? 0;
      if (planned === 0) {
        setErr(
          out?.error === "org_not_set_for_location"
            ? "No org bound to this location. Bind an org first."
            : out?.error === "location_not_bound"
              ? "Location missing Google binding (integration/account/location fields)."
              : "Planner ran but inserted 0 posts (likely horizon already planned or rule disabled)."
        );
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshPosts() {
    if (!locationId) return;
    setBusy(true);
    setErr("");
    try {
      const p = await api(`/api/v1/recurrence/posts?locationId=${encodeURIComponent(locationId)}`);
      setPosts(p.posts || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100"
        title="Open Recurrence + AI Content Lab"
      >
        Recurrence Lab
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />

          <div className="absolute right-0 top-0 h-full w-full max-w-[760px] bg-white shadow-xl border-l overflow-auto">
            <div className="p-4 border-b flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-lg">Recurrence + AI Content Lab</div>
                <div className="text-xs text-gray-500">
                  1) Bind org → 2) Save rule (Enabled) → 3) Plan now → posts appear
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => refreshPosts().catch(() => {})}
                  disabled={busy || !canUse}
                  className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <div className="text-sm text-gray-600 mb-2">Active Location</div>
                <ActiveLocationPicker value={locationId} onChange={setLocationId} />
              </div>

              {!canUse ? <div className="text-sm text-gray-600">Pick a location first.</div> : null}
              {err ? <div className="text-sm text-red-700">{err}</div> : null}

              {/* Binding status */}
              <div className="border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">Org bound to this location</div>
                    <div className="text-xs text-gray-500">This org is what AI uses for post generation.</div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {binding?.org ? "✅ bound" : "⚠️ not bound"}
                  </div>
                </div>

                <div className="mt-3 text-sm">
                  {binding?.org ? (
                    <div className="space-y-1">
                      <div className="font-medium">{binding.org.name}</div>
                      <div className="text-xs text-gray-600">{binding.org.website || "-"}</div>
                      <div className="text-xs text-gray-600">{binding.org.industry || "-"}</div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-600">No org bound yet. Bind one below.</div>
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <select
                    className="flex-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                  >
                    <option value="">-- pick existing org --</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name || o.id}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || !locationId || !selectedOrgId}
                    onClick={() => bindSelectedOrg().catch(() => {})}
                    className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                  >
                    Bind
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ORG create */}
                <div className="border rounded-xl p-4 space-y-3">
                  <div className="font-semibold">Create a new org (optional)</div>
                  <div className="text-xs text-gray-500">Use this if you don’t already have an org saved.</div>

                  <input
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    placeholder="Business name"
                    value={orgForm.name}
                    onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  />

                  <input
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    placeholder="Website"
                    value={orgForm.website}
                    onChange={(e) => setOrgForm({ ...orgForm, website: e.target.value })}
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="px-3 py-2 rounded-lg border text-sm bg-white"
                      value={orgForm.industry}
                      onChange={(e) => setOrgForm({ ...orgForm, industry: e.target.value })}
                    >
                      {INDUSTRIES.map((x) => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </select>

                    {orgForm.industry === "Other" ? (
                      <input
                        className="px-3 py-2 rounded-lg border text-sm"
                        placeholder="Industry (custom)"
                        value={orgForm.industryOther}
                        onChange={(e) => setOrgForm({ ...orgForm, industryOther: e.target.value })}
                      />
                    ) : (
                      <div className="px-3 py-2 rounded-lg border text-sm bg-gray-50 text-gray-500">
                        Selected
                      </div>
                    )}
                  </div>

                  <textarea
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    rows={3}
                    placeholder="Short description (what you do)"
                    value={orgForm.description}
                    onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })}
                  />

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={showOrgAdvanced}
                      onChange={(e) => setShowOrgAdvanced(e.target.checked)}
                    />
                    Show AI style fields
                  </label>

                  {showOrgAdvanced ? (
                    <div className="space-y-2">
                      <input
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        placeholder="Services (comma separated)"
                        value={orgForm.servicesCsv}
                        onChange={(e) => setOrgForm({ ...orgForm, servicesCsv: e.target.value })}
                      />
                      <input
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        placeholder="Keywords (comma separated)"
                        value={orgForm.keywordsCsv}
                        onChange={(e) => setOrgForm({ ...orgForm, keywordsCsv: e.target.value })}
                      />
                      <input
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        placeholder="Tone (friendly / luxury / professional...)"
                        value={orgForm.tone}
                        onChange={(e) => setOrgForm({ ...orgForm, tone: e.target.value })}
                      />
                      <input
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        placeholder="Offers / promos (optional)"
                        value={orgForm.offers}
                        onChange={(e) => setOrgForm({ ...orgForm, offers: e.target.value })}
                      />
                      <input
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        placeholder="Do NOT mention (optional)"
                        value={orgForm.doNotMention}
                        onChange={(e) => setOrgForm({ ...orgForm, doNotMention: e.target.value })}
                      />
                    </div>
                  ) : null}

                  <button
                    disabled={busy || !locationId || !orgForm.name.trim()}
                    onClick={() => saveNewOrgAndBind().catch(() => {})}
                    className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                  >
                    Create + Bind
                  </button>
                </div>

                {/* RULE */}
                <div className="border rounded-xl p-4 space-y-3">
                  <div className="font-semibold">Recurrence Rule</div>
                  <div className="text-xs text-gray-500">
                    If “Enabled” is OFF, planner will ignore this rule.
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!ruleForm.enabled}
                      onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })}
                    />
                    Enabled
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="px-3 py-2 rounded-lg border text-sm bg-white"
                      value={ruleForm.mode}
                      onChange={(e) => setRuleForm({ ...ruleForm, mode: e.target.value })}
                    >
                      <option value="manual">manual</option>
                      <option value="auto">auto</option>
                    </select>

                    <select
                      className="px-3 py-2 rounded-lg border text-sm bg-white"
                      value={ruleForm.frequency}
                      onChange={(e) => setRuleForm({ ...ruleForm, frequency: e.target.value })}
                    >
                      <option value="daily">daily</option>
                      <option value="weekly">weekly</option>
                      <option value="monthly">monthly</option>
                      <option value="yearly">yearly</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="px-3 py-2 rounded-lg border text-sm"
                      type="number"
                      min={1}
                      max={30}
                      value={ruleForm.count}
                      onChange={(e) => setRuleForm({ ...ruleForm, count: e.target.value })}
                    />

                    <select
                      className="px-3 py-2 rounded-lg border text-sm bg-white"
                      value={ruleForm.timezoneChoice}
                      onChange={(e) => setRuleForm({ ...ruleForm, timezoneChoice: e.target.value })}
                    >
                      {TIMEZONES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {ruleForm.timezoneChoice === "Custom" ? (
                    <input
                      className="px-3 py-2 rounded-lg border text-sm w-full"
                      placeholder="Custom timezone (IANA format e.g. Asia/Kolkata)"
                      value={ruleForm.timezoneCustom}
                      onChange={(e) => setRuleForm({ ...ruleForm, timezoneCustom: e.target.value })}
                    />
                  ) : null}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Window start</div>
                      <input
                        className="px-3 py-2 rounded-lg border text-sm w-full"
                        type="time"
                        value={ruleForm.windowStart}
                        onChange={(e) => setRuleForm({ ...ruleForm, windowStart: e.target.value })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Window end</div>
                      <input
                        className="px-3 py-2 rounded-lg border text-sm w-full"
                        type="time"
                        value={ruleForm.windowEnd}
                        onChange={(e) => setRuleForm({ ...ruleForm, windowEnd: e.target.value })}
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!ruleForm.ai_image_enabled}
                      onChange={(e) => setRuleForm({ ...ruleForm, ai_image_enabled: e.target.checked })}
                    />
                    Generate AI images (quality-gated)
                  </label>

                  <textarea
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    rows={4}
                    value={ruleForm.template.summary}
                    onChange={(e) => setRuleForm({ ...ruleForm, template: { summary: e.target.value } })}
                    placeholder="Post brief / content instructions"
                  />

                  <div className="flex gap-2 flex-wrap">
                    <button
                      disabled={busy || !locationId}
                      onClick={() => saveRule().catch(() => {})}
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                    >
                      Save Rule
                    </button>
                    <button
                      disabled={busy || !locationId}
                      onClick={() => planNow().catch(() => {})}
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                      title="Creates posts immediately (no waiting for cron)"
                    >
                      Plan Now
                    </button>
                  </div>

                  <div className="text-xs text-gray-500">
                    Rule loaded: {rule ? "yes" : "no"} · Last planned: {rule?.last_planned_at ? fmtDate(rule.last_planned_at) : "-"}
                  </div>
                </div>
              </div>

              {/* POSTS */}
              <div className="border rounded-xl p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-semibold">Planned Posts (latest 200)</div>
                  <button
                    disabled={busy || !locationId}
                    onClick={() => refreshPosts().catch(() => {})}
                    className="px-3 py-1.5 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>

                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-4">Planned</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">AI</th>
                        <th className="py-2 pr-4">Image</th>
                        <th className="py-2 pr-4">Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {posts.map((p) => (
                        <tr key={p.id} className="border-b align-top">
                          <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(p.planned_for)}</td>
                          <td className="py-2 pr-4">{p.status || "-"}</td>
                          <td className="py-2 pr-4">
                            <div className="text-xs">
                              {p.ai_status || "-"}
                              {p.ai_error ? <div className="text-red-700 mt-1">{p.ai_error}</div> : null}
                            </div>
                          </td>
                          <td className="py-2 pr-4">
                            {p.image_url ? (
                              <a className="underline text-xs" href={p.image_url} target="_blank" rel="noreferrer">
                                open
                              </a>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 max-w-[520px]">
                            <div className="text-xs text-gray-700 whitespace-pre-wrap">{p.summary || "(pending)"}</div>
                          </td>
                        </tr>
                      ))}
                      {!posts.length ? (
                        <tr>
                          <td className="py-3 text-gray-500" colSpan={5}>
                            No posts yet. Bind an org → enable rule → Plan Now.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Note: if AI stays pending forever, your <b>post-generate worker</b> isn’t running.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
