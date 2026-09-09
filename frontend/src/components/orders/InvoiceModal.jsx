import { useCallback } from 'react'
import { Printer, Download, FileText, CheckCircle2 } from 'lucide-react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import Modal from '../common/Modal'
import { formatCurrency, formatDateTime } from '../../utils/format'

export default function InvoiceModal({ open, orderId, onClose }) {
  const fetcher = useCallback(() => api.get(`/orders/${orderId}/invoice`).then((res) => res.data.data), [orderId])
  const { data: invoice, loading, error } = useApiQuery(open ? fetcher : () => Promise.resolve(null))

  function handlePrint() {
    window.print()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Tax Invoice — #${orderId}`}
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
            Shifter Online Logistics Platform
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-3 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              Close
            </button>
            <button
              type="button"
              disabled={!invoice}
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--brand)' }}
            >
              <Printer size={14} /> Print / Save PDF
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex h-48 items-center justify-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          Loading invoice details…
        </div>
      ) : error ? (
        <div className="p-4 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      ) : !invoice ? null : (
        <div className="space-y-4 p-1 print:p-0">
          {/* Header */}
          <div className="flex items-start justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[17px] font-bold tracking-tight" style={{ color: 'var(--brand)' }}>
                SHIFTER ONLINE
              </div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                On-Demand Logistics & Delivery Services
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] font-semibold font-mono-data" style={{ color: 'var(--ink)' }}>
                INV-{invoice.order_id}
              </div>
              <div className="text-[11.5px] font-mono-data mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                Date: {invoice.invoice_date ? formatDateTime(invoice.invoice_date) : '—'}
              </div>
              {invoice.gst_number && (
                <div className="text-[11px] font-mono-data" style={{ color: 'var(--ink-faint)' }}>
                  GST: {invoice.gst_number}
                </div>
              )}
            </div>
          </div>

          {/* Customer & Driver Info */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Billed To (Customer)
              </div>
              <div className="text-[13px] font-medium mt-1" style={{ color: 'var(--ink)' }}>
                {invoice.customer?.name || 'Customer'}
              </div>
              <div className="text-[12px] font-mono-data" style={{ color: 'var(--ink-muted)' }}>
                {invoice.customer?.mobile || '—'}
              </div>
              {invoice.customer?.email && (
                <div className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                  {invoice.customer.email}
                </div>
              )}
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Fulfilled By (Delivery Partner)
              </div>
              <div className="text-[13px] font-medium mt-1" style={{ color: 'var(--ink)' }}>
                {invoice.driver?.name || 'Unassigned / Not assigned'}
              </div>
              <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Trip Distance: <span className="font-mono-data font-medium">{invoice.distance_km || 0} KM</span>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="space-y-1.5 text-[12px] rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <span className="font-semibold" style={{ color: 'var(--brand)' }}>Pickup: </span>
              <span style={{ color: 'var(--ink)' }}>{invoice.pickup_address}</span>
            </div>
            <div>
              <span className="font-semibold" style={{ color: 'var(--success)' }}>Delivery: </span>
              <span style={{ color: 'var(--ink)' }}>{invoice.delivery_address}</span>
            </div>
          </div>

          {/* Line Items Breakdown Table */}
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-left text-[12.5px]">
              <thead style={{ background: 'var(--bg)', color: 'var(--ink-faint)' }}>
                <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase">Item / Charge Description</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {invoice.line_items?.map((item, index) => (
                  <tr key={index}>
                    <td className="px-3 py-1.5" style={{ color: 'var(--ink)' }}>
                      {item.label}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-mono-data font-medium"
                      style={{ color: item.amount < 0 ? 'var(--success)' : 'var(--ink)' }}
                    >
                      {formatCurrency(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: 'var(--bg)' }}>
                <tr className="border-t font-semibold" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-3 py-2.5 text-[13px]" style={{ color: 'var(--ink)' }}>
                    Total Payable Amount
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-data text-[15px]" style={{ color: 'var(--brand)' }}>
                    {formatCurrency(invoice.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payment Status Footer */}
          <div className="flex items-center justify-between text-[11.5px] pt-1" style={{ color: 'var(--ink-muted)' }}>
            <span>Payment Status: <strong style={{ color: 'var(--ink)' }}>{invoice.payment_status || 'Paid / Verified'}</strong></span>
            <span>Thank you for choosing Shifter Online!</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
