const { ADVANCE_PAYMENT_TIMEOUT_MS } = require("../config/constants");

// Shared by orderController.mapInfo (customer tracking screen) and
// driverOrderHistoryController.pkgHistoryDriver (driver trip list) - both
// display the same 2-minute advance-payment countdown, ported once here
// instead of twice. Node port of the legacy PHP's getAdvancePaymentTimerInfo()
// (admin/include/advance_payment_helper.php).
function getAdvancePaymentTimerInfo(order) {
  const timeoutSeconds = ADVANCE_PAYMENT_TIMEOUT_MS / 1000;
  const advAmount = Number(order.advance_payment || 0);
  const payStatus = Number(order.payment_status || 0);
  const orderStatus = Number(order.order_status || 0);
  const oStatus = String(order.o_status || "").toLowerCase();
  const acceptTime = order.accept_time ? new Date(order.accept_time) : null;

  const isClosed = orderStatus >= 4 || oStatus === "completed" || oStatus === "cancelled";
  let isAdvanceRequired = false;
  let timePassed = 0;
  let remainingSeconds = 0;

  if (!isClosed && advAmount > 0 && payStatus === 0 && (orderStatus === 1 || orderStatus === 0)) {
    isAdvanceRequired = true;
    const refTime = acceptTime || (order.odate ? new Date(order.odate) : null);
    if (refTime && !Number.isNaN(refTime.getTime())) {
      let refMs = refTime.getTime();
      // Defensive normalization: if accept_time was stored with +330 min (IST offset)
      // into a UTC DATETIME column, refMs appears ~5.5 hours in the future.
      if (refMs - Date.now() > 4 * 3600 * 1000) {
        refMs -= 330 * 60 * 1000;
      }
      const diffSec = Math.floor((Date.now() - refMs) / 1000);
      timePassed = Math.max(0, diffSec);
      remainingSeconds = Math.max(0, timeoutSeconds - timePassed);
    } else {
      remainingSeconds = timeoutSeconds;
    }
  }

  return {
    advance_payment: advAmount.toFixed(2),
    payment_status: isClosed ? 1 : payStatus,
    accept_time: order.accept_time || "",
    advance_timeout_seconds: timeoutSeconds,
    time_passed_seconds: timePassed,
    remaining_seconds: remainingSeconds,
    is_advance_payment_required: isAdvanceRequired,
    is_advance_required: isAdvanceRequired,
  };
}

module.exports = { getAdvancePaymentTimerInfo };
