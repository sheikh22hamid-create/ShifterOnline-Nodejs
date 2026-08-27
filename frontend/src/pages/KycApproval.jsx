import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import DocumentDecisionCard from '../components/kyc/DocumentDecisionCard'
import DocumentImageViewer from '../components/kyc/DocumentImageViewer'
import { verificationTone } from '../utils/driverStatus'
import { KYC_DOC_TYPES } from '../utils/kycDoc'

export default function KycApproval() {
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState('pending')
  const [selectedId, setSelectedId] = useState(null)
  const [activeDocKey, setActiveDocKey] = useState(null)
  const [rejectSignal, setRejectSignal] = useState({})
  const [busy, setBusy] = useState(false)

  const listFetcher = useCallback(() => api.get('/riders', { params: { verification_status: statusFilter || undefined } }).then((res) => res.data.data), [statusFilter])
  const { data: drivers, loading: listLoading, refetch: refetchList } = useApiQuery(listFetcher)

  useEffect(() => {
    if (!drivers) return
    // Keeps the selection valid as the queue refreshes (status filter
    // change, or a decision moving the driver out of this queue) — a real
    // transition, not a first-render duplicate.
    if (!drivers.find((d) => d.id === selectedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(drivers[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers])

  const detailFetcher = useCallback(() => (selectedId ? api.get(`/riders/${selectedId}`).then((res) => res.data.data) : Promise.resolve(null)), [selectedId])
  const { data: rider, loading: detailLoading, refetch: refetchDetail } = useApiQuery(detailFetcher)

  const docTypes = rider
    ? KYC_DOC_TYPES.map((d) => ({ ...d, status: d.getStatus(rider), recordId: d.getRecordId ? d.getRecordId(rider) : undefined, images: d.getImages(rider) }))
    : []

  useEffect(() => {
    if (docTypes.length > 0 && !docTypes.find((d) => d.key === activeDocKey)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveDocKey(docTypes[0].key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider])

  async function handleDecide(documentType, recordId, isApprove, rejectionReason) {
    setBusy(true)
    try {
      await api.post(`/riders/${selectedId}/kyc-decision`, {
        document_type: documentType,
        record_id: recordId,
        is_approve: isApprove,
        rejection_reason: rejectionReason,
      })
      toast.success(isApprove ? 'Document approved.' : 'Document rejected.')
      refetchDetail()
      refetchList()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not record this decision.')
    } finally {
      setBusy(false)
    }
  }

  // A/R keyboard shortcuts act on the clicked/active document card (spec
  // §6.2.2's "rapid decision bar").
  useEffect(() => {
    function onKey(e) {
      if (!activeDocKey || busy) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const doc = docTypes.find((d) => d.key === activeDocKey)
      if (!doc || doc.status === undefined || doc.status === null) return
      if (e.key === 'a' || e.key === 'A') handleDecide(doc.key, doc.recordId, 1)
      if (e.key === 'r' || e.key === 'R') setRejectSignal((s) => ({ ...s, [activeDocKey]: (s[activeDocKey] || 0) + 1 }))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocKey, docTypes, busy])

  const activeDoc = docTypes.find((d) => d.key === activeDocKey)

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        KYC Approval Dock
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Click a document, then press <kbd className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--border)' }}>A</kbd> to approve or{' '}
        <kbd className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--border)' }}>R</kbd> to reject.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[220px_320px_1fr]">
        <div className="surface-card overflow-hidden rounded-xl">
          <div className="flex gap-1 border-b p-2" style={{ borderColor: 'var(--border)' }}>
            {['pending', 'approved', 'rejected'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className="flex-1 rounded-md px-2 py-1 text-[11px] font-medium capitalize"
                style={{
                  background: statusFilter === s ? 'var(--brand-soft)' : 'transparent',
                  color: statusFilter === s ? 'var(--brand)' : 'var(--ink-muted)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
            {listLoading && (
              <p className="px-3 py-8 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                Loading…
              </p>
            )}
            {!listLoading && drivers?.length === 0 && (
              <p className="px-3 py-8 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                No drivers in this queue.
              </p>
            )}
            {!listLoading &&
              drivers?.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className="flex w-full items-center justify-between border-b px-3 py-2.5 text-left last:border-b-0"
                  style={{ borderColor: 'var(--border)', background: selectedId === d.id ? 'var(--bg)' : 'transparent' }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px]" style={{ color: 'var(--ink)' }}>
                      {d.full_name || `Driver #${d.id}`}
                    </div>
                    <div className="font-mono-data text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                      {d.fmobile}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>

        {!selectedId && (
          <div className="surface-card col-span-2 flex h-64 flex-col items-center justify-center gap-2 rounded-xl">
            <ShieldCheck size={22} style={{ color: 'var(--ink-faint)' }} />
            <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
              Select a driver to review their documents.
            </p>
          </div>
        )}

        {selectedId && (detailLoading || !rider) && (
          <div className="surface-card col-span-2 flex h-64 items-center justify-center rounded-xl" style={{ color: 'var(--ink-faint)' }}>
            Loading dossier…
          </div>
        )}

        {selectedId && !detailLoading && rider && (
          <>
            <div className="space-y-3">
              <div className="surface-card rounded-xl p-3.5">
                <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {rider.full_name}
                </div>
                <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                  {rider.fmobile}
                </div>
                <div className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                  {rider.vehicle} · {rider.vehicle_no}
                </div>
                <div className="mt-2">
                  <Badge tone={verificationTone(rider.verification_status)}>{rider.verification_status}</Badge>
                </div>
              </div>
              <div className="space-y-2">
                {docTypes.map((doc) => (
                  <DocumentDecisionCard
                    key={doc.key}
                    docType={doc}
                    active={activeDocKey === doc.key}
                    onFocus={setActiveDocKey}
                    onDecide={handleDecide}
                    busy={busy}
                    rejectSignal={rejectSignal[doc.key]}
                  />
                ))}
              </div>
            </div>

            <div style={{ minHeight: 420 }}>
              {activeDoc?.images?.length > 0 ? (
                <div className="grid h-full grid-cols-1 gap-3" style={{ gridTemplateRows: activeDoc.images.length > 1 ? '1fr 1fr' : '1fr' }}>
                  {activeDoc.images.map((img) => (
                    <DocumentImageViewer key={img.label} src={img.src} label={`${activeDoc.label} — ${img.label}`} />
                  ))}
                </div>
              ) : (
                <div className="surface-card flex h-full items-center justify-center rounded-xl text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                  {activeDoc ? 'No image for this document type.' : 'Select a document to inspect it.'}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
