// Loading/Unloading labour escrow state machine (spec 2026-11-24, Phase 1).
// Pure decisions — no DB. labourEscrowService wraps these with prisma writes + wallet moves.
// Statuses: none | held | released | refunded | disputed | resolved.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Should the held labour be released to the driver now?
 * Release only from 'held', and never while a dispute is open (the dispute freezes the escrow).
 * Any other status is a no-op, so a repeated drop-OTP never double-pays.
 */
function releasePlan(labourStatus, hasOpenDispute) {
  if (labourStatus === "held" && !hasOpenDispute) {
    return { act: true, nextStatus: "released" };
  }
  return { act: false, nextStatus: labourStatus };
}

/**
 * Should the held labour be refunded to the customer on cancel?
 * Only from 'held'. Once released (driver paid) or disputed (executive decides) there is no
 * auto-refund; a second cancel is a no-op.
 */
function refundPlan(labourStatus) {
  if (labourStatus === "held") {
    return { act: true, nextStatus: "refunded" };
  }
  return { act: false, nextStatus: labourStatus };
}

/** The amount actually in escrow: declared base, plus the on-site extra only once the customer approved it. */
function payableTotal({ base, extra, extraApproved }) {
  const b = round2(base) || 0;
  const e = extraApproved ? (round2(extra) || 0) : 0;
  return round2(b + e);
}

module.exports = { releasePlan, refundPlan, payableTotal };
