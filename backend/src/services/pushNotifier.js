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
  const reasonText = reason === "timeout" ? "Your offer window has expired." : "This order is no longer available.";
  return sendPushNotification(
    fcmToken,
    "Order No Longer Available",
    reasonText,
    { type: "order_dismiss", order_id: String(orderId), reason: String(reason) }
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

module.exports = {
  notifyDriverOrderRequest,
  notifyDriverDismiss,
  notifyCustomerOrderAssigned,
  notifyCustomerNoDriverFound,
};
