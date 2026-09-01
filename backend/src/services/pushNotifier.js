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
  return sendPushNotification(
    fcmToken,
    "Order Taken",
    "This order is no longer available.",
    {
      type: "ORDER_CLOSED",
      action: "close_popup",
      reason: String(reason),
      order_id: String(orderId),
      silent: "1",
    }
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
