const prisma = require("../config/db");
const logger = require("../utils/logger");
const adminSocket = require("../sockets/adminSocket");
const { assignRiderToOrder } = require("./orderAssignmentService");

// Booking Guarantee "New Ride Trial Driver": the executive reviews the offered Trial Driver and the bot waits for
// that driver to install the app and go online. The moment they do, the held order is assigned to them here, so the
// executive no longer has to click "Assign Order to Driver". "Not Convinced" still wins: a rejected candidate is no
// longer live, so nothing is assigned.

// The driver's socket joins its room a moment after the status call returns; assigning a beat later means the
// "order:assigned" push reaches the app instead of racing it. Direct assign events are also re-sent below.
const AUTO_ASSIGN_DELAY_MS = 2500;
const SYSTEM_ACTOR = { id: 0, username: "system" };
const AUTO_EVENT = "trial_driver_auto_assigned";
// Outcomes that just mean "somebody else got there first": nothing for the executive to act on.
const BENIGN_STATUSES = new Set([409]);

/** Assigns the held order to this rider if they are the live Trial Driver candidate of an open case. Never throws. */
async function autoAssignIfOffered(riderId) {
  try {
    const live = await prisma.guarantee_outside_candidate.findFirst({ where: { rider_id: Number(riderId), active: 1 } });
    if (!live) return { assigned: false, reason: "not_offered" };

    const [caseRow, order, rider] = await Promise.all([
      prisma.booking_guarantee_case.findUnique({ where: { id: live.case_id } }),
      prisma.pkg_order.findUnique({ where: { id: live.order_id } }),
      prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { city_id: true } }),
    ]);
    if (!caseRow || caseRow.status !== "open" || !order) return { assigned: false, reason: "case_closed" };
    // Defence in depth: a Trial Driver is registered in the order's own city, so a mismatch means something is off
    // (e.g. the rider was moved) and a person should look instead of the system assigning across cities.
    if (!rider || Number(rider.city_id) !== Number(order.city_id)) {
      adminSocket.notifyDispatchAlert(order.id, order.city_id, `Trial Driver is online but is not in this order's city, so order #${order.id} was not assigned automatically. Check and assign manually.`, {
        kind: "trial_driver_auto_assign_failed", rider_id: Number(riderId),
      });
      return { assigned: false, reason: "city_mismatch" };
    }

    const result = await assignRiderToOrder({
      order,
      riderId: Number(riderId),
      actor: SYSTEM_ACTOR,
      closeAdminId: null,
      closeEvent: AUTO_EVENT,
      remark: `Auto-assigned: Trial Driver #${riderId} came online for Booking Guarantee order #${order.id}`,
    });

    if (result.ok) {
      adminSocket.notifyDispatchAlert(order.id, order.city_id, `Trial Driver ${live.name || `#${riderId}`} is online: order #${order.id} was assigned automatically`, {
        kind: "trial_driver_auto_assigned", rider_id: Number(riderId),
      });
      return { assigned: true };
    }
    if (!BENIGN_STATUSES.has(result.status)) {
      // The candidate stays live, so the executive can still assign by hand once they know why it did not happen.
      adminSocket.notifyDispatchAlert(order.id, order.city_id, `Trial Driver is online but order #${order.id} could not be assigned automatically (${result.message}). Assign it manually.`, {
        kind: "trial_driver_auto_assign_failed", rider_id: Number(riderId),
      });
    }
    return { assigned: false, reason: result.message };
  } catch (err) {
    logger.error(`trialDriverAutoAssign: rider ${riderId} failed:`, err);
    return { assigned: false, reason: "error" };
  }
}

/** Call when a rider has just gone online. Fire-and-forget; the check re-runs after the delay so a rejection in between wins. */
function scheduleOnOnline(rider) {
  if (!rider || rider.a_status !== 1) return;
  const timer = setTimeout(() => { autoAssignIfOffered(rider.id); }, AUTO_ASSIGN_DELAY_MS);
  if (typeof timer.unref === "function") timer.unref();
}

module.exports = { autoAssignIfOffered, scheduleOnOnline, AUTO_ASSIGN_DELAY_MS, AUTO_EVENT };
