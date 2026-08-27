import { useRef, useState } from 'react'
import { ZoomIn, ZoomOut, RotateCcw, ImageOff } from 'lucide-react'
import { resolveImageUrl } from '../../utils/imageUrl'

const MIN_ZOOM = 1
const MAX_ZOOM = 4

/**
 * Pan/zoom document viewer. Resolves the legacy-relative path (e.g.
 * "images/category/x.png") against VITE_IMAGE_BASE_URL — see
 * backend/src/app.js's LEGACY_IMAGES_DIR static mount. Falls back honestly
 * (raw path shown) when that folder isn't actually configured/present.
 */
export default function DocumentImageViewer({ src: rawSrc, label }) {
  const src = resolveImageUrl(rawSrc)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [errored, setErrored] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  // Drag start coordinates don't need to be reactive — only isDragging
  // (read during render for the transition style) does.
  const dragState = useRef(null)

  function reset() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  function onWheel(e) {
    e.preventDefault()
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.0015)))
  }

  function onMouseDown(e) {
    if (zoom <= 1) return
    dragState.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
    setIsDragging(true)
  }
  function onMouseMove(e) {
    if (!dragState.current) return
    const { startX, startY, panX, panY } = dragState.current
    setPan({ x: panX + (e.clientX - startX), y: panY + (e.clientY - startY) })
  }
  function onMouseUp() {
    dragState.current = null
    setIsDragging(false)
  }

  if (!src || errored) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center" style={{ borderColor: 'var(--border)' }}>
        <ImageOff size={22} style={{ color: 'var(--ink-faint)' }} />
        <p className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
          {rawSrc ? "No preview available — set LEGACY_IMAGES_DIR (backend) so this file can be found." : 'Not uploaded'}
        </p>
        {rawSrc && (
          <code className="max-w-full truncate rounded border px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)' }}>
            {rawSrc}
          </code>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
        <span className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          {label}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.5))} style={{ color: 'var(--ink-faint)' }} aria-label="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5))} style={{ color: 'var(--ink-faint)' }} aria-label="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button type="button" onClick={reset} style={{ color: 'var(--ink-faint)' }} aria-label="Reset">
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
      <div
        className="relative flex-1 overflow-hidden"
        style={{ background: '#0c0e13', cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <img
          src={src}
          alt={label}
          draggable={false}
          onError={() => setErrored(true)}
          className="absolute left-1/2 top-1/2 max-w-none select-none"
          style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: isDragging ? 'none' : 'transform 0.1s ease-out' }}
        />
      </div>
    </div>
  )
}
