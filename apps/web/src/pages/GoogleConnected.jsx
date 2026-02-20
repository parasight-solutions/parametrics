import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export default function GoogleConnected() {
  const [qp] = useSearchParams()
  const nav = useNavigate()
  useEffect(() => {
    const ok = qp.get('connected') === 'google'
    const t = setTimeout(() => nav('/'), 1500)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="p-6 bg-white shadow rounded">
        <div className="text-lg font-semibold">Google connected ✔️</div>
        <div className="text-sm text-gray-600">Taking you back…</div>
      </div>
    </div>
  )
}
