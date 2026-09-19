import { useState, useEffect } from 'react'
import { User, ShieldCheck, Clock, CreditCard, Car, FileText, CheckCircle2 } from 'lucide-react'
import Modal from '../common/Modal'
import api from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'

const INITIAL_FORM = {
  full_name: '',
  fmobile: '',
  smobile: '',
  email: '',
  dob: '',
  nationality: 'Indian',
  full_address: '',
  city_id: '',
  vehicle: '',
  vehicle_no: '',
  aadhar_id: '',
  pan_id: '',
  lic_id: '',
  rc_number: '',
  has_third_party_rc: false,
  rc_owner_name: '',
  rc_owner_aadhar_number: '',
  account_name: '',
  account_number: '',
  ifsc: '',
  bank_name: '',
  branch_name: '',
  upi_id: '',
  plan_type: 'general',
  working_hours: '8',
  verification_status: 'approved',
  payment_complete: true,
}

export default function CreateDriverModal({ open, onClose, onSuccess, cities = [], vehicles = [] }) {
  const toast = useToast()
  const { user } = useAuth()
  const [form, setForm] = useState(INITIAL_FORM)
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')

  // Prefill city_id if user has a scoped city
  useEffect(() => {
    if (open) {
      setForm({
        ...INITIAL_FORM,
        city_id: user?.city_id ? String(user.city_id) : cities[0]?.id ? String(cities[0].id) : '',
        vehicle: vehicles[0]?.title || vehicles[0]?.cat_name || 'Bike',
      })
      setActiveTab('basic')
    }
  }, [open, user, cities, vehicles])

  function updateField(key, val) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.full_name.trim()) {
      toast.error('Driver full name is required')
      setActiveTab('basic')
      return
    }
    if (!form.fmobile.trim() || form.fmobile.replace(/\D/g, '').length < 10) {
      toast.error('Valid 10-digit mobile number is required')
      setActiveTab('basic')
      return
    }
    if (!form.vehicle.trim()) {
      toast.error('Vehicle category is required')
      setActiveTab('vehicle')
      return
    }
    if (!form.vehicle_no.trim()) {
      toast.error('Vehicle plate number is required')
      setActiveTab('vehicle')
      return
    }
    if (!form.city_id) {
      toast.error('City assignment is required')
      setActiveTab('vehicle')
      return
    }

    setBusy(true)
    try {
      const payload = {
        ...form,
        full_name: form.full_name.trim(),
        fmobile: form.fmobile.trim(),
        smobile: form.smobile.trim() || null,
        email: form.email.trim() || null,
        dob: form.dob.trim() || null,
        nationality: form.nationality.trim() || 'Indian',
        full_address: form.full_address.trim() || null,
        city_id: parseInt(form.city_id, 10),
        vehicle: form.vehicle.trim(),
        vehicle_no: form.vehicle_no.trim().toUpperCase(),
        aadhar_id: form.aadhar_id.trim() || null,
        pan_id: form.pan_id.trim().toUpperCase() || null,
        lic_id: form.lic_id.trim() || null,
        rc_number: form.rc_number.trim() || form.vehicle_no.trim().toUpperCase(),
        rc_owner_name: form.has_third_party_rc && form.rc_owner_name.trim() ? form.rc_owner_name.trim() : null,
        rc_owner_aadhar_number: form.has_third_party_rc && form.rc_owner_aadhar_number.trim() ? form.rc_owner_aadhar_number.trim() : null,
        account_name: form.account_name.trim() || form.full_name.trim(),
        account_number: form.account_number.trim() || null,
        ifsc: form.ifsc.trim().toUpperCase() || null,
        bank_name: form.bank_name.trim() || null,
        branch_name: form.branch_name.trim() || null,
        upi_id: form.upi_id.trim() || null,
        working_hours: form.working_hours ? parseInt(form.working_hours, 10) : 8,
        plan_type: form.plan_type || 'general',
        verification_status: form.verification_status,
        payment_complete: form.payment_complete ? 1 : 0,
      }

      const res = await api.post('/riders', payload)
      toast.success(res.data?.message || 'Driver created successfully!')
      onClose()
      onSuccess?.(res.data?.data)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create driver')
    } finally {
      setBusy(false)
    }
  }

  const TABS = [
    { id: 'basic', label: '1. Basic Info', icon: User },
    { id: 'vehicle', label: '2. Vehicle & City', icon: Car },
    { id: 'docs', label: '3. Documents (IDs)', icon: FileText },
    { id: 'bank', label: '4. Bank & Status', icon: CreditCard },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add New Driver (Manual Onboarding)"
      width={680}
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: form.verification_status === 'approved' ? 'var(--success)' : 'var(--warning)' }} />
            <span>
              Creating as <strong>{form.verification_status === 'approved' ? 'Approved (Active)' : 'Pending Review'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-3.5 py-1.5 text-[13px] font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleSubmit}
              className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <CheckCircle2 size={14} />
              {busy ? 'Creating Driver…' : 'Create & Onboard Driver'}
            </button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Step Tabs */}
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors"
                style={{
                  borderColor: isActive ? 'var(--brand)' : 'transparent',
                  color: isActive ? 'var(--brand)' : 'var(--ink-muted)',
                }}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab 1: Basic Info */}
        {activeTab === 'basic' && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={form.full_name}
                  onChange={(e) => updateField('full_name', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Primary Mobile <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  maxLength={10}
                  placeholder="10-digit mobile (e.g. 9876543210)"
                  value={form.fmobile}
                  onChange={(e) => updateField('fmobile', e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Alternate Mobile (Optional)
                </label>
                <input
                  type="tel"
                  maxLength={10}
                  placeholder="Alternate phone"
                  value={form.smobile}
                  onChange={(e) => updateField('smobile', e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="driver@example.com"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Date of Birth (DOB)
                </label>
                <input
                  type="date"
                  value={form.dob}
                  onChange={(e) => updateField('dob', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Nationality
                </label>
                <input
                  type="text"
                  value={form.nationality}
                  onChange={(e) => updateField('nationality', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div className="col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Full Residential Address
                </label>
                <textarea
                  rows={2}
                  placeholder="Complete residential address with house no., street, area, pincode"
                  value={form.full_address}
                  onChange={(e) => updateField('full_address', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setActiveTab('vehicle')}
                className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Next: Vehicle & City →
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Vehicle & City */}
        {activeTab === 'vehicle' && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  City <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={form.city_id}
                  onChange={(e) => updateField('city_id', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                >
                  <option value="">Select City</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Vehicle Category <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={form.vehicle}
                  onChange={(e) => updateField('vehicle', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                >
                  <option value="">Select Vehicle</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.title || v.cat_name}>
                      {v.title || v.cat_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Vehicle Plate Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MP09AB1234"
                  value={form.vehicle_no}
                  onChange={(e) => updateField('vehicle_no', e.target.value.toUpperCase())}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data font-semibold text-[13px] uppercase outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setActiveTab('basic')}
                className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('docs')}
                className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Next: Document Numbers →
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Document Numbers */}
        {activeTab === 'docs' && (
          <div className="space-y-3 pt-1">
            <div className="rounded-xl border p-3 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              Enter the driver&apos;s government verification numbers. You can also upload photos later from the driver details drawer.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Aadhaar Card Number
                </label>
                <input
                  type="text"
                  maxLength={14}
                  placeholder="12-digit Aadhaar Number"
                  value={form.aadhar_id}
                  onChange={(e) => updateField('aadhar_id', e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  PAN Card Number
                </label>
                <input
                  type="text"
                  maxLength={10}
                  placeholder="10-character PAN (e.g. ABCDE1234F)"
                  value={form.pan_id}
                  onChange={(e) => updateField('pan_id', e.target.value.toUpperCase())}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] uppercase outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Driving License (DL) Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. MP09-20180012345"
                  value={form.lic_id}
                  onChange={(e) => updateField('lic_id', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Vehicle RC Number
                </label>
                <input
                  type="text"
                  placeholder="Defaults to plate number"
                  value={form.rc_number || form.vehicle_no}
                  onChange={(e) => updateField('rc_number', e.target.value.toUpperCase())}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] uppercase outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>
            </div>

            {/* Third-party RC owner checkbox */}
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <label className="flex items-center gap-2 text-[12px] font-medium cursor-pointer" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={form.has_third_party_rc}
                  onChange={(e) => updateField('has_third_party_rc', e.target.checked)}
                  className="rounded"
                />
                <span>RC is registered to a different owner (Third-Party RC)</span>
              </label>

              {form.has_third_party_rc && (
                <div className="mt-2.5 grid grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      RC Owner Name
                    </label>
                    <input
                      type="text"
                      placeholder="Vehicle Owner Name"
                      value={form.rc_owner_name}
                      onChange={(e) => updateField('rc_owner_name', e.target.value)}
                      className="w-full rounded-lg border px-2.5 py-1 text-[12.5px] outline-none"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      RC Owner Aadhaar Number
                    </label>
                    <input
                      type="text"
                      maxLength={14}
                      placeholder="12-digit Aadhaar"
                      value={form.rc_owner_aadhar_number}
                      onChange={(e) => updateField('rc_owner_aadhar_number', e.target.value.replace(/\D/g, ''))}
                      className="w-full rounded-lg border px-2.5 py-1 font-mono-data text-[12.5px] outline-none"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setActiveTab('vehicle')}
                className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('bank')}
                className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Next: Bank & Status →
              </button>
            </div>
          </div>
        )}

        {/* Tab 4: Bank & Status */}
        {activeTab === 'bank' && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Account Holder Name
                </label>
                <input
                  type="text"
                  placeholder="Defaults to driver name"
                  value={form.account_name}
                  onChange={(e) => updateField('account_name', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Account Number
                </label>
                <input
                  type="text"
                  placeholder="Bank account number"
                  value={form.account_number}
                  onChange={(e) => updateField('account_number', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  IFSC Code
                </label>
                <input
                  type="text"
                  maxLength={11}
                  placeholder="e.g. SBIN0001234"
                  value={form.ifsc}
                  onChange={(e) => updateField('ifsc', e.target.value.toUpperCase())}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] uppercase outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  UPI ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. 9876543210@paytm"
                  value={form.upi_id}
                  onChange={(e) => updateField('upi_id', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 font-mono-data text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Bank Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. State Bank of India"
                  value={form.bank_name}
                  onChange={(e) => updateField('bank_name', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Branch Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. MG Road Branch"
                  value={form.branch_name}
                  onChange={(e) => updateField('branch_name', e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>
            </div>

            {/* Approval & Status Configuration */}
            <div className="mt-3 rounded-xl border p-3.5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink)' }}>
                Initial Verification & Onboarding Status
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    KYC Verification Status
                  </label>
                  <select
                    value={form.verification_status}
                    onChange={(e) => updateField('verification_status', e.target.value)}
                    className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none font-medium"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
                  >
                    <option value="approved">Approved (Direct Onboard - Ready for Trips)</option>
                    <option value="pending">Pending (Requires KYC Review)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    Verification Payment
                  </label>
                  <select
                    value={form.payment_complete ? '1' : '0'}
                    onChange={(e) => updateField('payment_complete', e.target.value === '1')}
                    className="w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none font-medium"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
                  >
                    <option value="1">Paid (Verification Fee Cleared)</option>
                    <option value="0">Pending (Payment Due)</option>
                  </select>
                </div>
              </div>

              <p className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                Setting &ldquo;Approved&rdquo; automatically marks Aadhaar, PAN, DL, and RC as approved and enables all delivery tiers for this vehicle category immediately.
              </p>
            </div>

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setActiveTab('docs')}
                className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
              >
                ← Back
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
