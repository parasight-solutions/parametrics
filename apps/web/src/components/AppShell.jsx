// apps/web/src/components/AppShell.jsx
import { useEffect, useMemo, useState } from "react";
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

export default function AppShell({ title, subtitle, onLogout, actions, children }) {
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
              <Link
                to="/posts/new"
                className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-100"
              >
                New Post
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {actions}
            {onLogout ? (
              <button
                onClick={onLogout}
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100"
              >
                Logout
              </button>
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
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle ? <p className="text-sm text-gray-600 mt-1">{subtitle}</p> : null}
        </div>

        {children}
      </main>
    </div>
  );
}
