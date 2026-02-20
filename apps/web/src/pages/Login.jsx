import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api, setToken } from "../apiClient";
import GoogleLoginButton from '../components/GoogleLoginButton'

export default function Login({ onAuthed }) {
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('Admin@123456')
  const [err, setErr] = useState('')
  const navigate = useNavigate()
  const location = useLocation()

  // Consume ?gjwt=... from OIDC callback
  useEffect(() => {
    const qp = new URLSearchParams(location.search)
    const gjwt = qp.get('gjwt')
    if (gjwt) {
      // localStorage.setItem('token', gjwt)
      setToken(gjwt);
      onAuthed({})
      navigate('/', { replace: true })
    }
  }, [location.search])

  async function submit(e) {
    e.preventDefault()
    setErr('')
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email, password }, auth: false })
      // localStorage.setItem('token', data.token)
      setToken(data.token);
      onAuthed(data.user)
      navigate('/', { replace: true })
    } catch (e) {
      setErr(e?.message || 'Login failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white shadow rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {err ? <div className="text-red-600 text-sm">{err}</div> : null}
        <input className="w-full border rounded px-3 py-2" placeholder="Email"
               value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password"
               value={password} onChange={e=>setPassword(e.target.value)} />
        <button className="w-full bg-indigo-600 text-white rounded py-2">Login</button>

        <div className="pt-2 border-t mt-4">
          <div className="text-xs text-gray-500 mb-2 text-center">or</div>
          <GoogleLoginButton />
        </div>
      </form>
    </div>
  )
}
