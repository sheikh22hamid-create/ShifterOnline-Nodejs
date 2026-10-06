// Pure decision rules for the Free Booking Offer (spec 2026-10-06). No I/O here:
// freeBookingService.js feeds these the data it loaded.

const STATUS = Object.freeze({
  CONFIRMED: "FREE_BOOKING_CONFIRMED",
  REWARD_PENDING: "FREE_BOOKING_REWARD_PENDING",
  REWARD_CREDITED: "FREE_BOOKING_REWARD_CREDITED",
  NOT_ELIGIBLE: "FREE_BOOKING_NOT_ELIGIBLE",
});
const OPEN_STATUSES = Object.freeze([STATUS.CONFIRMED, STATUS.REWARD_PENDING]);

const OUTCOME = Object.freeze({
  ELIGIBLE: "eligible",
  NO_FREE_VEHICLE: "no_free_vehicle",
  LOCKED: "locked",
  NOT_PREMIUM: "not_premium",
  OFFER_OFF: "offer_off",
  OPEN_BOOKING: "open_booking",
});

const REASON = Object.freeze({
  CANCELLED: "cancelled",
  VEHICLE_CHANGED: "vehicle_changed",
  LOCKED: "locked",
  ZERO_FARE: "zero_fare",
  POOL_UNAVAILABLE: "pool_unavailable",
  ADMIN_VOID: "admin_void",
});

const OUTCOME_MESSAGE = Object.freeze({
  [OUTCOME.ELIGIBLE]: "Free Booking applied. After the trip is completed and paid, the full trip amount will be credited to your Shifter wallet.",
  [OUTCOME.NO_FREE_VEHICLE]: "No free vehicle is available near your pickup right now. You can continue with a paid vehicle, but you will NOT receive any refund for this trip.",
  [OUTCOME.LOCKED]: "Free Booking is locked. Complete a successful referral to unlock it.",
  [OUTCOME.NOT_PREMIUM]: "Free Booking is only for Premium users.",
  [OUTCOME.OFFER_OFF]: "Free Booking is not available right now.",
  [OUTCOME.OPEN_BOOKING]: "Your earlier Free Booking is still being settled. You can book again once it is credited.",
});

const PAID_SETTLEMENT_STATUSES = Object.freeze(["cash_received", "paid_online"]);
const IST_OFFSET_MS = 330 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function istDateString(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function isCityOfferOpen(setting, now = new Date()) {
  if (!setting || !setting.enabled) return false;
  if (!setting.offer_start || !setting.offer_end) return false;
  const t = now.getTime();
  return t >= new Date(setting.offer_start).getTime() && t <= new Date(setting.offer_end).getTime();
}

function decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound }) {
  if (!premium) return OUTCOME.NOT_PREMIUM;
  if (!cityOpen) return OUTCOME.OFFER_OFF;
  if (locked) return OUTCOME.LOCKED;
  if (openBooking) return OUTCOME.OPEN_BOOKING;
  return poolVehicleFound ? OUTCOME.ELIGIBLE : OUTCOME.NO_FREE_VEHICLE;
}

// No settlement row = nothing was left to collect (prepaid / online / settlement feature off).
function isPaymentSettled(settlement) {
  if (!settlement) return true;
  return PAID_SETTLEMENT_STATUSES.includes(settlement.status);
}

function decideCredit({ row, order, userLocked, paymentSettled }) {
  if (!row || !OPEN_STATUSES.includes(row.status)) return { action: "skip" };
  if (order?.o_status === "Cancelled") return { action: "void", reason: REASON.CANCELLED };
  if (order?.o_status !== "Completed" || row.actual_fare == null) return { action: "wait" };
  if (!row.accepted_in_pool || Number(order.rid) !== Number(row.pool_rider_id)) {
    return { action: "void", reason: REASON.VEHICLE_CHANGED };
  }
  if (!paymentSettled) return { action: "wait" };
  if (userLocked) return { action: "void", reason: REASON.LOCKED };
  const amount = round2(row.actual_fare);
  if (amount <= 0) return { action: "void", reason: REASON.ZERO_FARE };
  return { action: "credit", amount };
}

module.exports = {
  STATUS, OPEN_STATUSES, OUTCOME, REASON, OUTCOME_MESSAGE, PAID_SETTLEMENT_STATUSES,
  round2, istDateString, isCityOfferOpen, decideOutcome, isPaymentSettled, decideCredit,
};
