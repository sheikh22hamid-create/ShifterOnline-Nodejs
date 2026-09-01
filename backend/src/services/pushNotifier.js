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
  // We do not send FCM push for dismiss because Flutter's background message handler
  // opens a blank "Unknown Pickup Location" dialog whenever ANY FCM data push arrives.
  // The Flutter popup automatically dismisses itself on its 15s timer, and Socket.IO
  // handles real-time UI dismissal when the app is active.
  return Promise.resolve({ sent: false, skipped: true });
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
