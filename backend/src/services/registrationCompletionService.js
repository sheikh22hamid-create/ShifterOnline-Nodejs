const prisma = require("../config/db");

// "Complete Registration" support for the driver app Profile screen.
//
// Registration only hard-requires Aadhaar, Driving Licence, Vehicle RC, a live
// photo and a vehicle (see NewRegistrationActivity.validateAndRegister). PAN,
// insurance, PUC, bank details and email are optional and can be skipped, and a
// trial driver (admin-created, name + mobile + vehicle only) has none of it yet.
// This builds the list of what is still missing so the app can show it.

const TRIAL_OPEN = ["active", "exhausted", "blocked"];

const filled = (v) => String(v ?? "").trim() !== "";

// done | under_review (submitted, admin has not approved) | pending (optional,
// skipped) | not_uploaded (optional image never sent) | required_pending
function docItem(key, label, { required, hasValue, approved, rejected = false, image = false }) {
  let status;
  // A rejected document counts as missing so the driver can submit it again.
  if (!hasValue || rejected) status = required ? "required_pending" : image ? "not_uploaded" : "pending";
  else if (approved === false) status = "under_review";
  else status = "done";
  return { key, label, required, status };
}

function buildRegistrationStatus(rider, doc) {
  const isTrial = TRIAL_OPEN.includes(rider.trial_status) && rider.verification_status !== "approved";
  const isBicycle = doc?.is_bycle === 1;

  const allItems = [
    docItem("aadhaar", "Aadhaar Card", { required: true, hasValue: filled(doc?.aadhar_id), approved: doc?.aadhar_status === 1 }),
    ...(isBicycle ? [] : [docItem("dl", "Driving Licence", { required: true, hasValue: filled(doc?.lic_id), approved: doc?.lic_status === 1 })]),
    docItem("rc", "Vehicle RC", { required: true, hasValue: filled(doc?.residence_id), approved: doc?.residence_status === 1 }),
    docItem("photo", "Profile Photo", { required: true, hasValue: filled(rider.profile_picture) }),
    docItem("pan", "PAN Card", { required: false, hasValue: filled(doc?.pan_id), approved: doc?.pan_status === 1, rejected: doc?.pan_status === 2 }),
    docItem("insurance", "Insurance", { required: false, hasValue: filled(doc?.bima_image), image: true }),
    docItem("puc", "PUC Certificate", { required: false, hasValue: filled(doc?.puc_image), image: true }),
    docItem("bank", "Bank Details", { required: false, hasValue: filled(rider.account_number) && filled(rider.ifsc) }),
    docItem("email", "Email", { required: false, hasValue: filled(rider.email) }),
  ];

  // The required eKYC documents only matter for a trial driver. A normal driver is
  // already approved (possibly by an admin without any documents), and is only
  // ever asked for the optional items registration let them skip.
  const items = isTrial ? allItems : allItems.filter((i) => !i.required);

  const pending = items.filter((i) => i.status === "required_pending" || i.status === "pending" || i.status === "not_uploaded");
  return {
    is_trial: isTrial,
    trial_status: rider.trial_status || "none",
    // A trial driver finishes through the full registration (eKYC) flow; an
    // already-registered normal driver only fills what is still missing.
    flow: isTrial ? "full_registration" : "remaining_documents",
    is_complete: pending.length === 0,
    pending_count: pending.length,
    items,
  };
}

async function getRegistrationStatus(riderId) {
  const [rider, doc] = await Promise.all([
    prisma.tbl_rider.findUnique({ where: { id: riderId } }),
    prisma.tbl_personal_doc.findFirst({ where: { rider_id: riderId } }),
  ]);
  if (!rider) return null;
  return buildRegistrationStatus(rider, doc);
}

module.exports = { buildRegistrationStatus, getRegistrationStatus, TRIAL_OPEN };
