// Loading/Unloading on-site mismatch gate (spec 2026-11-24, Phase 1).
// When the real situation is bigger than what the customer declared, the driver proposes an extra
// (priced from the same slab, over-cap allowed since the driver is physically there) with a photo.
// The extra is only held once the customer approves it BEFORE the extra work begins. Pure decisions
// here; labourExtraService does the prisma writes + photo + wallet hold.

const { computeLabourRaw } = require("./labourPricing");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** The extra to charge: corrected reality priced on the slab, minus the already-held base. Never negative. */
function extraDelta(correctedInput, config, currentBase) {
  const corrected = computeLabourRaw(correctedInput, config);
  return round2(Math.max(0, corrected - (round2(currentBase) || 0)));
}

/** A driver may propose an extra only while the labour is still held (not released/refunded/disputed). */
function canAddExtra(labourStatus) {
  return labourStatus === "held";
}

/** The customer may approve a pending extra only while held, not yet approved, and a positive amount. */
function canApproveExtra({ labourStatus, extraApproved, extraAmount }) {
  return labourStatus === "held" && !extraApproved && round2(extraAmount) > 0;
}

module.exports = { extraDelta, canAddExtra, canApproveExtra };
