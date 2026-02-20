export default function GoogleConnectButton({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "group relative inline-flex items-center gap-3",
        "rounded-md border border-gray-300 bg-white px-4 py-2",
        "text-sm font-medium text-gray-900 shadow-sm",
        "hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
      ].join(" ")}
      aria-label="Connect Google"
    >
      {/* Google 'G' SVG (brand-colors) */}
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 31.9 29.3 35 24 35 16.8 35 11 29.2 11 22s5.8-13 13-13c3.3 0 6.3 1.2 8.6 3.3l5.7-5.7C34.3 3.2 29.4 1 24 1 11.8 1 2 10.8 2 23s9.8 22 22 22c11 0 20-8 20-22 0-1.5-.2-2.9-.4-4.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.4 16.6 18.8 13 24 13c3.3 0 6.3 1.2 8.6 3.3l5.7-5.7C34.3 3.2 29.4 1 24 1 15.5 1 8.2 5.8 4.7 13.1l1.6 1.6z"/>
        <path fill="#4CAF50" d="M24 45c5.2 0 10-1.7 13.7-4.7l-6.3-5.3C29.1 36.4 26.7 37 24 37c-5.3 0-9.8-3.4-11.4-8.1l-6.6 5.1C8.4 41.9 15.6 45 24 45z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.3-3.8 5.8-7.1 6.9.1-.1 13.8 10.6 13.8 10.6C44 41.3 46 35 46 29c0-2.9-.4-5.1-1.2-8.5z"/>
      </svg>
      <span>{children || "Continue with Google"}</span>
    </button>
  )
}
