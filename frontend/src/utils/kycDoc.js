// tbl_vehicle_details.v_pic is a legacy multi-value-in-one-field column —
// real data shows multiple paths joined with "$;" (confirmed live, e.g.
// "images/vehicle/x.jpg$;images/vehicle/y.jpg") rather than one path per row.
function splitVehiclePics(vPic) {
  if (!vPic) return [{ label: 'Vehicle photo', src: null }]
  return vPic
    .split('$;')
    .filter(Boolean)
    .map((src, i, arr) => ({ label: arr.length > 1 ? `Photo ${i + 1}` : 'Vehicle photo', src }))
}

// Mirrors backend/src/controllers/adminRiderController.js's DOC_TYPE_HANDLERS —
// address/residence/license live on rider.personal_doc (no record_id needed),
// rc/vehicle_photo/bank/kit need the specific child-table row id.
export const KYC_DOC_TYPES = [
  {
    key: 'address',
    label: 'Address proof',
    getStatus: (r) => r.personal_doc?.address_status,
    getImages: (r) => [
      { label: 'Front', src: r.personal_doc?.address_front },
      { label: 'Back', src: r.personal_doc?.address_back },
    ],
  },
  {
    key: 'residence',
    label: 'Residence proof',
    getStatus: (r) => r.personal_doc?.residence_status,
    getImages: (r) => [
      { label: 'Front', src: r.personal_doc?.residence_front },
      { label: 'Back', src: r.personal_doc?.residence_back },
    ],
  },
  {
    key: 'license',
    label: 'Driving license',
    getStatus: (r) => r.personal_doc?.lic_status,
    getImages: (r) => [
      { label: 'Front', src: r.personal_doc?.lic_front },
      { label: 'Back', src: r.personal_doc?.lic_back },
    ],
  },
  {
    key: 'rc',
    label: 'Vehicle RC',
    getStatus: (r) => r.vehicle_details?.[0]?.status,
    getRecordId: (r) => r.vehicle_details?.[0]?.id,
    getImages: (r) => splitVehiclePics(r.vehicle_details?.[0]?.v_pic),
  },
  {
    key: 'vehicle_photo',
    label: 'Vehicle photo',
    getStatus: (r) => r.vehicle_details?.[0]?.status,
    getRecordId: (r) => r.vehicle_details?.[0]?.id,
    getImages: (r) => splitVehiclePics(r.vehicle_details?.[0]?.v_pic),
  },
  {
    key: 'bank',
    label: 'Bank account',
    getStatus: (r) => r.bank_accounts?.[0]?.status,
    getRecordId: (r) => r.bank_accounts?.[0]?.id,
    getImages: () => [],
  },
  {
    key: 'kit',
    label: 'Delivery kit',
    getStatus: (r) => r.kit?.kit_status,
    getRecordId: (r) => r.kit?.id,
    getImages: (r) => [{ label: 'Kit photo', src: r.kit?.img }],
  },
]

// 0/1/2 convention per adminRiderController.js's DOC_STATUS constant.
export const DOC_STATUS_LABELS = ['Pending', 'Approved', 'Rejected']
export const DOC_STATUS_TONES = ['warning', 'success', 'danger']

export const REJECTION_CHIPS = ['Blurry photo', 'Expired document', 'Document mismatch', 'Wrong document type', 'Information unreadable']
