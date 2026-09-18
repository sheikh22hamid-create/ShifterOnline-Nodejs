import { useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import api from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { resolveImageUrl } from '../../utils/imageUrl'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

// Shared "pick a file from your computer" control for the admin-panel image
// fields (category icons, vehicle images, etc.) that previously only took a
// pasted path/URL. Uploads straight to the existing generic
// POST /upload-image endpoint (already wired to Cloudinary, just never had a
// frontend control calling it) and writes the returned relative path back
// through onChange, same as the manual text input it sits next to.
export default function ImageUploadField({ label, value, onChange, folder = 'category', placeholder }) {
  const toast = useToast()
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const previewUrl = resolveImageUrl(value)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    const formData = new FormData()
    formData.append('image', file)
    formData.append('folder', folder)

    setUploading(true)
    try {
      const res = await api.post('/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onChange(res.data.path)
      toast.success('Image uploaded.')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Image upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          {label}
        </label>
      )}
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
          ) : (
            <span className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>No image</span>
          )}
        </div>
        <div className="flex-1 space-y-1.5">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
            style={FIELD_STYLE}
            placeholder={placeholder}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--brand)' }}
          >
            <UploadCloud size={12} /> {uploading ? 'Uploading…' : 'Upload from computer'}
          </button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileChange} />
        </div>
      </div>
    </div>
  )
}
