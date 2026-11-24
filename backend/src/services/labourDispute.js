// Loading/Unloading labour dispute — pure decisions (spec 2026-11-24, Phase 1).
// A dispute freezes the held labour escrow; an executive resolves it by releasing to the driver,
// refunding the customer, or splitting. labourDisputeService wraps these with prisma + wallet moves.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Split the held total between driver and customer per the executive's chosen action. Money is
 * always conserved exactly: driver + refund === heldTotal (refund is the remainder, so no rounding
 * leak). For 'split' the driver amount is clamped into [0, heldTotal].
 */
function resolveAmounts(action, heldTotal, driverAmountInput) {
  const total = round2(heldTotal) || 0;
  if (action === "release") return { driver: total, refund: 0 };
  if (action === "refund") return { driver: 0, refund: total };
  if (action === "split") {
    const driver = Math.min(total, Math.max(0, round2(driverAmountInput) || 0));
    return { driver, refund: round2(total - driver) };
  }
  throw Object.assign(new Error("Unknown dispute action"), { statusCode: 400 });
}

/** Phase 1: a dispute can be raised only while the labour is still held and none is already open. */
function canRaise(labourStatus, hasOpenDispute) {
  return labourStatus === "held" && !hasOpenDispute;
}

module.exports = { resolveAmounts, canRaise };
