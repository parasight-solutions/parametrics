// apps/web/src/components/AppShell.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const nav = [
  { to: "/", label: "Dashboard" },
  { to: "/integrations", label: "Integrations" },
  { to: "/posts", label: "Posts" },
  { to: "/reviews", label: "Reviews" },
];

function readReauth() {
  try {
    const raw = sessionStorage.getItem("reauth_required");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.provider !== "google") return null;
    return obj;
  } catch {
    return null;
  }
}

export default function AppShell({ title, subtitle, onLogout, actions, tools, children }) {
  const loc = useLocation();
  const isActive = (to) => (to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(to));

  const [reauth, setReauth] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // Re-check when route changes
  useEffect(() => {
    const r = readReauth();
    setReauth(r);
    setDismissed(!!sessionStorage.getItem("reauth_required_dismissed"));
  }, [loc.pathname, loc.search]);

  const showBanner = useMemo(() => {
    if (!reauth) return false;
    if (dismissed) return false;
    // don't show on login page
    if (loc.pathname.startsWith("/login")) return false;
    return true;
  }, [reauth, dismissed, loc.pathname]);

  function dismissBanner() {
    try {
      sessionStorage.setItem("reauth_required_dismissed", "1");
    } catch {}
    setDismissed(true);
  }

  const bannerMsg =
    reauth?.message || "Google connection expired/revoked. Please reconnect Google.";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-semibold tracking-tight">
              ParaMetrics
            </Link>

            <nav className="hidden md:flex items-center gap-3 text-sm">
              {nav.map((i) => (
                <Link
                  key={i.to}
                  to={i.to}
                  className={`px-3 py-2 rounded-lg ${
                    isActive(i.to)
                      ? "bg-gray-900 text-white"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {i.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <HeaderMenu label="Tools">
              {tools || (
                <Link
                  to="/recurrence"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Recurrence Lab
                </Link>
              )}
            </HeaderMenu>

            {onLogout ? (
              <HeaderMenu label="Account" align="right">
                <button
                  type="button"
                  onClick={onLogout}
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Logout
                </button>
              </HeaderMenu>
            ) : null}
          </div>
        </div>

        {showBanner ? (
          <div className="border-t bg-amber-50">
            <div className="max-w-6xl mx-auto px-6 py-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="text-sm text-amber-900">
                <div className="font-semibold">Action required: Reconnect Google</div>
                <div className="text-amber-900/90">{bannerMsg}</div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  to="/integrations?reauth=google"
                  className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"
                >
                  Reconnect Google
                </Link>
                <button
                  onClick={dismissBanner}
                  className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            {subtitle ? <p className="text-sm text-gray-600 mt-1">{subtitle}</p> : null}
          </div>

          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>

        {children}
      </main>
    </div>
  );
}

function HeaderMenu({ label, children, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="px-3 py-2 rounded-lg border bg-white text-sm text-gray-700 hover:bg-gray-100"
      >
        {label}
      </button>

      {open ? (
        <div
          role="menu"
          onClickCapture={() => setOpen(false)}
          className={`absolute top-full mt-2 w-44 rounded-lg border bg-white py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
