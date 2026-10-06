const { sendPushNotification } = require("../config/firebase");
const { saveCustomerNotificationByToken } = require("./customerInbox");
const { getAdvancePaymentTimeoutMinutes } = require("../utils/advancePaymentTimeout");

function stringifyPayload(payload) {
  return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? "")]));
}

/** Customer push that is also kept in the app's Notification screen (tbl_notification). */
async function sendCustomerPush(fcmToken, title, body, data, channel) {
  await saveCustomerNotificationByToken(fcmToken, title, body);
  return channel ? sendPushNotification(fcmToken, title, body, data, channel) : sendPushNotification(fcmToken, title, body, data);
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

async function notifyDriverDismiss(fcmToken, orderId, reason, offer = {}) {
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
    stringifyPayload({ ...offer, type: "order_dismiss", order_id: String(orderId), reason: String(reason) }),
    "order_dismiss_channel_v1"
  );
}

async function notifyCustomerOrderAssigned(fcmToken, data) {
  return sendCustomerPush(
    fcmToken,
    "Order Assigned!",
    `${data.rider_name || "A driver"} is on the way.`,
    stringifyPayload({ ...data, type: "order_assigned" })
  );
}

async function notifyCustomerNoDriverFound(fcmToken, orderId) {
  return sendCustomerPush(
    fcmToken,
    "No drivers found",
    "No drivers found. None of the available drivers accepted your order. Please try again.",
    { type: "no_driver_found", order_id: String(orderId) }
  );
}

/** See tripLifecycle.sweepOverduePickups — customer never handed over the OTP within the OTP timeout of driver arrival. */
async function notifyCustomerPickupTimeoutCancel(fcmToken, orderId, cancellationCharge, timeoutMinutes) {
  const minutesText = timeoutMinutes ? `${timeoutMinutes} minutes` : "the allowed time";
  const chargeText = cancellationCharge > 0 ? ` A cancellation charge of ₹${cancellationCharge} has been applied.` : "";
  return sendCustomerPush(
    fcmToken,
    "Trip Cancelled",
    `Your driver waited ${minutesText} at pickup but didn't receive the OTP, so this trip was cancelled.${chargeText}`,
    { type: "order_cancelled", order_id: String(orderId), reason: "pickup_otp_timeout" }
  );
}

/**
 * Driver-side counterpart of notifyCustomerPickupTimeoutCancel — same event,
 * told from the driver's side. type "order_cancelled" (not "order_dismiss")
 * deliberately - this order was already accepted and may have
 * OrderDetailsActivity's OTP dialog open on screen; "order_dismiss" only
 * closes a still-pending pre-acceptance popup (see
 * MyFirebaseMessagingService's routing), which left that screen stuck
 * showing an expired countdown with no cancellation ever surfacing
 * (confirmed live: order #199) when the driver was backgrounded/killed at
 * the moment of cancellation and only this push - not the live socket event
 * tripLifecycle.cancelOverduePickup also emits - reached them.
 */
async function notifyDriverPickupTimeoutCancel(fcmToken, orderId, timeoutMinutes) {
  const minutesText = timeoutMinutes ? `${timeoutMinutes} minutes` : "the allowed time";
  return sendPushNotification(
    fcmToken,
    "Order Cancelled",
    `Customer did not provide the OTP within ${minutesText}. This trip has been cancelled and you're free for new orders.`,
    { type: "order_cancelled", order_id: String(orderId), reason: "pickup_otp_timeout" }
  );
}

/** See tripLifecycle.sweepExpiredAdvancePayments — customer never paid the advance within timeout of the driver accepting. */
async function notifyCustomerAdvancePaymentTimeoutCancel(fcmToken, orderId) {
  const timeoutMinutes = await getAdvancePaymentTimeoutMinutes().catch(() => 2);
  return sendCustomerPush(
    fcmToken,
    "Order Cancelled",
    `Order #${orderId} cancelled: the advance payment wasn't completed within ${timeoutMinutes} minutes.`,
    { type: "advance_timeout_cancel", action: "order_cancelled", order_id: String(orderId) }
  );
}

/** Driver-side counterpart of notifyCustomerAdvancePaymentTimeoutCancel — same event, told from the driver's side. */
async function notifyDriverAdvancePaymentTimeoutCancel(fcmToken, orderId) {
  const timeoutMinutes = await getAdvancePaymentTimeoutMinutes().catch(() => 2);
  return sendPushNotification(
    fcmToken,
    "Order Cancelled",
    `Customer did not pay the advance within ${timeoutMinutes} minutes. Order #${orderId} has been cancelled — you're free for new orders.`,
    { type: "order_dismiss", order_id: String(orderId), reason: "advance_payment_timeout" },
    "order_dismiss_channel_v1"
  );
}

/** See settlementSweep — the customer still owes the payment for a completed ride. */
async function notifyCustomerSettlementReminder(fcmToken, orderId, amount) {
  return sendCustomerPush(
    fcmToken,
    "Payment pending",
    `Please pay ₹${amount} for order #${orderId}. Pay your driver directly or pay online in the app.`,
    { type: "settlement_pending", order_id: String(orderId), amount: String(amount) }
  );
}

/** Driver-side counterpart: the customer's payment for a completed ride is still unconfirmed. */
async function notifyDriverSettlementReminder(fcmToken, orderId, amount) {
  return sendPushNotification(
    fcmToken,
    "Collect payment",
    `Order #${orderId}: ₹${amount} is still pending. Tap "Received" once the customer has paid.`,
    { type: "settlement_pending", order_id: String(orderId), amount: String(amount) }
  );
}

/**
 * See tripLifecycle.customerCancel — the customer cancelled an order this
 * driver already accepted, tapping Cancel themselves (not a timeout). The
 * "order:customer_cancelled" socket event alone only reaches the driver if
 * OrderDetailsActivity happens to be open in the foreground (confirmed
 * live: order stayed on screen as if still active otherwise). type
 * "order_cancelled" matches MyFirebaseMessagingService's existing routing
 * to SocketOrderRouter.handleOrderCancelledByCustomer, which shows the same
 * "Order Cancelled" dialog the socket path does, plus a heads-up/full-screen
 * notification with vibration when the app is backgrounded or killed.
 */
async function notifyDriverCustomerCancelled(fcmToken, orderId, reason) {
  return sendPushNotification(
    fcmToken,
    "Order Cancelled",
    reason
      ? `Order #${orderId} was cancelled by the customer: ${reason}`
      : `Order #${orderId} was cancelled by the customer.`,
    { type: "order_cancelled", order_id: String(orderId), reason: String(reason || "") }
  );
}

/** See tripLifecycle.sendScheduledOrderReminders — booking_type=2 order's schedule_date_time is ~10 minutes away. */
async function notifyCustomerScheduleReminder(fcmToken, orderId, scheduleTimeLabel) {
  return sendPushNotification(
    fcmToken,
    "Upcoming Scheduled Order",
    `Your scheduled order #${orderId} will be picked up around ${scheduleTimeLabel} (10 minutes left).`,
    { type: "schedule_reminder", order_id: String(orderId) }
  );
}

/** Scheduled ride confirmation prompt ("Do you still want to continue?") - see tripLifecycle.sendScheduledOrderReminders. */
async function notifyCustomerScheduleConfirm(fcmToken, orderId, scheduleTimeLabel) {
  return sendPushNotification(
    fcmToken,
    "Scheduled ride confirmation",
    `Your scheduled order #${orderId} is set for ${scheduleTimeLabel}. Do you still want to continue with this scheduled ride?`,
    { type: "schedule_confirm", order_id: String(orderId) }
  );
}

/** Admin answered a monthly driver's early duty-start request. */
async function notifyDriverEarlyStartDecision(fcmToken, approved) {
  return sendPushNotification(
    fcmToken,
    approved ? "Early start approved" : "Early start declined",
    approved ? "The admin approved your early duty start. You can start duty now." : "The admin declined your early duty start request.",
    { type: "early_start_decision", approved: approved ? "1" : "0" }
  );
}

/** A scheduled order the driver had pre-accepted was cancelled by the customer. */
async function notifyDriverScheduledCancelled(fcmToken, orderId) {
  return sendPushNotification(
    fcmToken,
    "Scheduled trip cancelled",
    `The customer cancelled scheduled order #${orderId} that you had accepted.`,
    { type: "scheduled_cancelled", order_id: String(orderId) }
  );
}

/** See dispatchManager's scheduled-order priority round — booking_type=2 order has moved from "scheduled" to actively searching for a driver. */
async function notifyCustomerOrderLive(fcmToken, orderId) {
  return sendCustomerPush(
    fcmToken,
    "Finding your driver",
    `We're now finding a driver for your scheduled order #${orderId}.`,
    { type: "schedule_live", order_id: String(orderId) }
  );
}

/** See dispatchManager's scheduled-order priority round — a driver was assigned close enough to schedule_date_time that pickup may run a few minutes late. */
async function notifyCustomerLatePickup(fcmToken, orderId, scheduleDateTime) {
  return sendCustomerPush(
    fcmToken,
    "Pickup may run a few minutes late",
    `Your driver for order #${orderId} was assigned close to your requested pickup time and may arrive a few minutes after it.`,
    { type: "schedule_late_pickup", order_id: String(orderId), schedule_date_time: scheduleDateTime || "" }
  );
}

/** See adminOrderController.assignNextDayBatch — admin pre-assigned a driver to this customer's next-day (booking_type=3) order the night before. */
async function notifyCustomerNextDayAssigned(fcmToken, data) {
  return sendCustomerPush(
    fcmToken,
    "Driver assigned for tomorrow",
    `${data.rider_name || "A driver"} has been assigned to pick you up tomorrow.`,
    stringifyPayload({ ...data, type: "next_day_assigned" })
  );
}

/** Fired by rewardPlanService whenever an admin-granted plan actually activates (immediate grant or a pending reward applied on ride completion). */
async function notifyRewardPlanAssigned(fcmToken, planName) {
  return sendPushNotification(
    fcmToken,
    "You've received a reward!",
    `You've been given the ${planName} plan.`,
    { type: "reward_plan_assigned" }
  );
}

/** Fired when customer reaches the admin-configured cumulative ride amount reward threshold */
async function notifyAmountRewardPlanAssigned(fcmToken, planName, minAmount, validityText = "1 mahine (30 din)") {
  return sendCustomerPush(
    fcmToken,
    "🎉 Milestone Reward Unlocked!",
    `Badhai ho! Total ₹${minAmount} ki rides complete karne par aapko ${validityText} ke liye ${planName} plan bilkul FREE mila hai!`,
    stringifyPayload({
      type: "reward_plan_assigned",
      plan_name: String(planName),
      min_amount: String(minAmount),
      validity: String(validityText),
    })
  );
}

/** Any driver-wallet ledger change (commission debit, cancellation compensation, payout approval, ...) - see services/walletNotifier.js. */
async function notifyDriverWalletTransaction(fcmToken, type, amountText, remark) {
  const isCredit = type === "credit";
  return sendPushNotification(
    fcmToken,
    isCredit ? "Wallet credited" : "Wallet debited",
    `${isCredit ? "+" : "-"}${amountText}${remark ? ` — ${remark}` : ""}`,
    { type: "wallet_transaction", txn_type: String(type), amount: amountText }
  );
}

/** Any customer-wallet ledger change (admin credit/debit, referral bonus, refund, ...) - see services/walletNotifier.js. */
async function notifyCustomerWalletTransaction(fcmToken, type, amountText, remark) {
  const isCredit = type === "credit";
  return sendPushNotification(
    fcmToken,
    isCredit ? "Wallet credited" : "Wallet debited",
    `${isCredit ? "+" : "-"}${amountText}${remark ? ` — ${remark}` : ""}`,
    { type: "wallet_transaction", txn_type: String(type), amount: amountText }
  );
}

/** Fired by dispatchManager.recordModel1Outcome once a rider's consecutive Model 1 misses hit the admin-configured limit. */
async function notifyDriverModel1Suspended(fcmToken, missLimit, suspensionHours) {
  return sendPushNotification(
    fcmToken,
    "Model 1 rides paused",
    `You ignored ${missLimit} Model 1 rides in a row, so Model 1 offers are paused for you for ${suspensionHours} hour${suspensionHours === 1 ? "" : "s"}.`,
    { type: "model1_suspended", miss_limit: String(missLimit), suspension_hours: String(suspensionHours) }
  );
}

/** Fired by forceAssignService when an admin force-assigns a scheduled order directly to a driver. */
async function notifyDriverForceAssigned(fcmToken, orderId) {
  return sendPushNotification(
    fcmToken,
    "Ride Assigned",
    `You have been assigned scheduled order #${orderId} by admin.`,
    { type: "force_assign", order_id: String(orderId) }
  );
}

/** Fired when customer updates the drop destination during an active trip. */
async function notifyDriverDestinationUpdated(fcmToken, orderId, newAddress, revisedFare) {
  return sendPushNotification(
    fcmToken,
    "Drop Location Updated",
    `Customer updated drop to ${newAddress}. Revised Fare: ₹${revisedFare}`,
    stringifyPayload({ type: "destination_updated", order_id: String(orderId), drop_address: String(newAddress), revised_fare: String(revisedFare) }),
    "order_channel"
  );
}

async function notifyDriverPickupUpdated(fcmToken, orderId, newAddress, revisedFare) {
  return sendPushNotification(
    fcmToken,
    "Pickup Location Updated",
    `Customer updated pickup to ${newAddress}. Revised Fare: ₹${revisedFare}`,
    stringifyPayload({ type: "pickup_updated", order_id: String(orderId), pickup_address: String(newAddress), revised_fare: String(revisedFare) }),
    "order_channel"
  );
}

async function notifyDriverStopAdded(fcmToken, orderId, stopAddress, revisedFare) {
  return sendPushNotification(
    fcmToken,
    "Stop Added",
    `Customer added a stop at ${stopAddress}. Revised Fare: ₹${revisedFare}`,
    stringifyPayload({ type: "stop_added", order_id: String(orderId), stop_address: String(stopAddress), revised_fare: String(revisedFare) }),
    "order_channel"
  );
}

/** Fired by adminRiderController.kycDecision - a driver's KYC document (RC, license, ...) was approved or rejected. */
async function notifyDriverKycDocumentDecision(fcmToken, documentLabel, isApproved, reason) {
  return sendPushNotification(
    fcmToken,
    isApproved ? "Document approved" : "Document rejected",
    isApproved
      ? `Your ${documentLabel} has been approved.`
      : `Your ${documentLabel} was rejected${reason ? `: ${reason}` : "."} Please re-upload from the app.`,
    stringifyPayload({ type: "kyc_document_decision", is_approved: isApproved ? "1" : "0", reason: reason || "" })
  );
}

/** Fired by adminRiderController.toggleStatus - admin blocked or reactivated a driver account. */
async function notifyDriverAccountStatus(fcmToken, isBlocked, reason) {
  return sendPushNotification(
    fcmToken,
    isBlocked ? "Account blocked" : "Account reactivated",
    isBlocked
      ? `Your driver account was blocked${reason ? `: ${reason}` : "."} Contact support to resolve this.`
      : "Your driver account has been reactivated.",
    stringifyPayload({ type: "account_status", is_blocked: isBlocked ? "1" : "0", reason: reason || "" })
  );
}

module.exports = {
  notifyCustomerSettlementReminder,
  notifyDriverSettlementReminder,
  notifyDriverOrderRequest,
  notifyDriverDismiss,
  notifyDriverForceAssigned,
  notifyDriverDestinationUpdated,
  notifyDriverPickupUpdated,
  notifyDriverStopAdded,
  notifyCustomerOrderAssigned,
  notifyCustomerNoDriverFound,
  notifyCustomerPickupTimeoutCancel,
  notifyDriverPickupTimeoutCancel,
  notifyCustomerAdvancePaymentTimeoutCancel,
  notifyDriverAdvancePaymentTimeoutCancel,
  notifyDriverCustomerCancelled,
  notifyCustomerScheduleReminder,
  notifyCustomerScheduleConfirm,
  notifyDriverScheduledCancelled,
  notifyDriverEarlyStartDecision,
  notifyCustomerOrderLive,
  notifyCustomerLatePickup,
  notifyCustomerNextDayAssigned,
  notifyRewardPlanAssigned,
  notifyAmountRewardPlanAssigned,
  notifyDriverModel1Suspended,
  notifyDriverWalletTransaction,
  notifyCustomerWalletTransaction,
  notifyDriverKycDocumentDecision,
  notifyDriverAccountStatus,
};

