const { sendPushNotification } = require("../config/firebase");

function stringifyPayload(payload) {
  return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? "")]));
}

async function notifyDriverOrderRequest(fcmToken, payload) {
  const customerName = payload.customer_name || "Customer";
  const earning = payload.estimated_earning || payload.driver_earning || "0";
  const modelName = payload.package_title || payload.model_name || "";
  const modelPrefix = modelName ? `[${modelName}] ` : "";

  return sendPushNotification(
    fcmToken,
    `${modelPrefix}New Order Request`,
    `${modelPrefix}New order from ${customerName} - ₹${earning}`,
    stringifyPayload({ ...payload, type: "order" })
  );
}

async function notifyDriverDismiss(fcmToken, orderId, reason) {
  // A backgrounded/killed driver app has no other way to learn its offer is
  // gone (Socket.IO only reaches an active foreground app), so this must
  // actually reach the device. It's sent as a real (non-data-only)
  // notification — see firebase.js's isDriverEvent — specifically so it
  // does NOT go through Flutter's background *data* handler, which is what
  // opens a blank "Unknown Pickup Location" dialog for any data-only push.
  // A real notification is drawn by the OS directly and never reaches that
  // handler, so it can't retrigger that bug.
  //
  // Explicit driver-app channel id — NOT the default "order_channel" that
  // sendPushNotification otherwise assumes (that one belongs to the
  // customer app's own separate codebase). The driver app (ShifterDriver)
  // only pre-creates its own specific channel ids; referencing one it never
  // created falls back to Android/FCM's own uncontrolled default channel,
  // confirmed live as the cause of this exact notification ringing
  // indefinitely until manually cleared.
  const reasonText = reason === "timeout" ? "Your offer window has expired." : "This order is no longer available.";
  return sendPushNotification(
    fcmToken,
    "Order No Longer Available",
    reasonText,
    { type: "order_dismiss", order_id: String(orderId), reason: String(reason) },
    "order_dismiss_channel_v1"
  );
}

async function notifyCustomerOrderAssigned(fcmToken, data) {
  return sendPushNotification(
    fcmToken,
    "Order Assigned!",
    `${data.rider_name || "A driver"} is on the way.`,
    stringifyPayload({ ...data, type: "order_assigned" })
  );
}

async function notifyCustomerNoDriverFound(fcmToken, orderId) {
  return sendPushNotification(
    fcmToken,
    "No Driver Found",
    "We couldn't find a driver for your order. Please try again.",
    { type: "no_driver_found", order_id: String(orderId) }
  );
}

/** See tripLifecycle.sweepOverduePickups — customer never handed over the OTP within 10 minutes of driver arrival. */
async function notifyCustomerPickupTimeoutCancel(fcmToken, orderId, cancellationCharge) {
  const chargeText = cancellationCharge > 0 ? ` A cancellation charge of ₹${cancellationCharge} has been applied.` : "";
  return sendPushNotification(
    fcmToken,
    "Trip Cancelled",
    `Your driver waited 10 minutes at pickup but didn't receive the OTP, so this trip was cancelled.${chargeText}`,
    { type: "order_cancelled", order_id: String(orderId), reason: "pickup_otp_timeout" }
  );
}

/** Driver-side counterpart of notifyCustomerPickupTimeoutCancel — same event, told from the driver's side. */
async function notifyDriverPickupTimeoutCancel(fcmToken, orderId) {
  return sendPushNotification(
    fcmToken,
    "Trip Cancelled",
    "Customer did not provide the OTP within 10 minutes. This trip has been cancelled and you're free for new orders.",
    { type: "order_cancelled", order_id: String(orderId), reason: "pickup_otp_timeout" },
    "order_dismiss_channel_v1"
  );
}

module.exports = {
  notifyDriverOrderRequest,
  notifyDriverDismiss,
  notifyCustomerOrderAssigned,
  notifyCustomerNoDriverFound,
  notifyCustomerPickupTimeoutCancel,
  notifyDriverPickupTimeoutCancel,
};
