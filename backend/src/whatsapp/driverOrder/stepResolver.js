// WhatsApp Trial Order (spec 2026-11-17, section 3): which step a WhatsApp-channel driver is on, derived ONLY from
// the order's live DB state (pkg_order + driver_trip_progress + stops + settlement). Pure: the bot keeps no step
// state of its own, so a change made from the driver app, the executive or Live Location is always respected.

// A completed order is waiting for the driver's cash confirmation only when its settlement is still pending and was
// not settled online. Settlement rows are only ever created for cash orders (tripLifecycle.updateStatus 'complete',
// isCashOrder) and `method` stays null until someone settles it, so pending + method not 'online' = cash to collect.
function isCashSettlementPending(settlement) {
  return settlement?.status === "pending" && settlement.method !== "online";
}

// What the driver must collect on a pending cash settlement: the same figure the driver app shows
// (settlementService.publicView receiver_pay_total) - amount_due, plus the booker's commission when the receiver pays.
function cashPayable(settlement) {
  if (!settlement) return null;
  const markup = settlement.payer === "receiver" ? Number(settlement.receiver_markup || 0) : 0;
  return Math.round((Number(settlement.amount_due) + markup) * 100) / 100;
}

function resolveStep({ order, progress, stops = [], dropOtpRequired = false, settlement = null }) {
  if (!order || order.o_status === "Cancelled") return { key: "cancelled" };
  if (order.o_status === "Completed") return isCashSettlementPending(settlement) ? { key: "await_cash" } : { key: "done" };

  const status = Number(order.order_status);
  if (status === 1) return { key: "go_pickup" };
  if (status === 2) return progress?.otp_verified_at ? { key: "loading" } : { key: "pickup_otp" };
  if (status === 3) {
    const step = Number(progress?.stop_step) || 0;
    const stopCount = stops.length;
    if (step % 2 === 0 && step / 2 < stopCount) return { key: "go_stop", stopNumber: step / 2 + 1 };
    if (step % 2 === 1 && (step + 1) / 2 <= stopCount) return { key: "at_stop", stopNumber: (step + 1) / 2 };
    if (step === stopCount * 2) return { key: "go_drop" };
    if (step === stopCount * 2 + 1) return { key: dropOtpRequired ? "drop_otp" : "at_drop" };
    // stop_step past the drop (should never happen): never guess an action, the driver is sent to the helpline.
    return { key: "unknown" };
  }
  // Pending (driver-cancel re-live / reassignment) or any other non-active state: this driver has no trip any more.
  return { key: "cancelled" };
}

/** Stable id of a step for session bookkeeping, e.g. "go_stop:2". */
function stepId(step) {
  return step.stopNumber ? `${step.key}:${step.stopNumber}` : step.key;
}

module.exports = { resolveStep, stepId, isCashSettlementPending, cashPayable };
