// apps/web/src/pages/NewPost.jsx
import { useState } from 'react'
import { api } from '../apiClient'
import { useNavigate } from 'react-router-dom'
import AppShell from "../components/AppShell";
import ActiveLocationPicker from "../components/ActiveLocationPicker";
import { getActiveLocationId } from "../session";

export default function NewPost({ onLogout }) {
  const [locationId, setLocationId] = useState(getActiveLocationId());
  const [summary, setSummary] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [cta, setCta] = useState('')
  const [schedule, setSchedule] = useState('') // yyyy-MM-ddTHH:mm
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const nav = useNavigate()

  // Authenticated upload bound to the selected location (JPEG/PNG, 5 MB max).
  async function uploadFile(file) {
    setErr('')
    if (!locationId) {
      setErr('Please choose a location before uploading an image')
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    try {
      const d = await api(`/uploads?locationId=${encodeURIComponent(locationId)}`, { method: 'POST', body: fd })
      setImageUrl(d.url)
    } catch (e) {
      const code = e?.code
      setErr(
        code === 'file_too_large' ? 'Image is larger than 5 MB'
          : code === 'unsupported_media_type' ? 'Only JPEG or PNG images can be uploaded'
            : 'Upload failed'
      )
    }
  }

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      if (!locationId) throw new Error('Please choose a location')
      if (!summary.trim()) throw new Error('Post text is required')

      const body = {
        locationId,
        summary,
        imageUrl: imageUrl || undefined,
        callToActionUrl: cta || undefined,
      }

      if (schedule) {
        body.publishNow = false
        body.scheduleAt = new Date(schedule).toISOString()
      } else {
        body.publishNow = true
      }

      await api('/posts', { method: 'POST', body })
      nav('/posts', { replace: true })
    } catch (e2) {
      setErr(e2?.message || 'Failed to submit')
    } finally { setBusy(false) }
  }

  return (
    <AppShell
      title="New Google Post"
      subtitle="Publish an update to a Business Profile location"
      onLogout={onLogout}
    >
      <div className="max-w-xl">
        {err ? <div className="text-red-600 text-sm">{err}</div> : null}

        <form onSubmit={submit} className="space-y-3 bg-white border rounded-xl p-4">
          <label className="block text-sm">
            <span className="text-gray-700">Location</span>
            <div className="mt-1">
              <ActiveLocationPicker value={locationId} onChange={setLocationId} />
            </div>
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Text</span>
            <textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
              rows="4"
              placeholder="What's new?"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">
              <span className="text-gray-700">Image URL (public)</span>
              <input
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2"
                placeholder="https://..."
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-700">…or Upload (dev)</span>
              <input
                type="file"
                accept="image/jpeg,image/png"
                disabled={!locationId}
                onChange={e => e.target.files?.[0] && uploadFile(e.target.files[0])}
                className="mt-1 w-full"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="text-gray-700">CTA URL (optional)</span>
            <input
              value={cta}
              onChange={e => setCta(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
              placeholder="https://..."
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Schedule (optional)</span>
            <input
              type="datetime-local"
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
            <div className="text-xs text-gray-500 mt-1">Leave empty to publish immediately.</div>
          </label>

          <div className="flex gap-2">
            <button disabled={busy} className="bg-gray-900 text-white rounded-lg px-4 py-2 hover:bg-black disabled:opacity-50">
              {schedule ? 'Schedule post' : 'Publish now'}
            </button>
            <button type="button" onClick={() => nav('/posts')} className="px-4 py-2 border rounded-lg hover:bg-gray-100">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
