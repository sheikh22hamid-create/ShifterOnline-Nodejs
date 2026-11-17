// WhatsApp Trial Order (spec 2026-11-17, section 3): the driver conversation for a driver_channel='whatsapp' order.
// A thin adapter: every message re-reads the order from the DB (stepResolver), and a reply maps to exactly ONE of
// the calls the driver app makes (tripLifecycle.updateStatus / driverTripService.progressTrip / driverCancel /
// settlementService.markCashReceived). The bot never advances a step itself and keeps no step state of its own -
// whatsapp_driver_session only holds a pending HAAN confirmation and send/reply bookkeeping.
const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../../config/constants");
const { normalizeToLast10Digits } = require("../../utils/phone");
const messages = require("./messages");
const { resolveStep, stepId, stepLabel, isCashSettlementPending, cashPayable } = require("./stepResolver");
const { isWhatsappDriver } = require("../../services/whatsappTrialSettings");

// Lazy: these services sit in a large require graph that also reaches the WhatsApp client; resolving them on use
// keeps a load-order cycle from ever handing this module a half-initialised exports object.
const tripLifecycle = () => require("../../services/tripLifecycle");
const driverTripService = () => require("../../services/driverTripService");
const settlementService = () => require("../../services/settlementService");
const dropOtp = () => require("../../services/dropOtp");
const notifications = () => require("../notifications");
const socketServer = () => require("../../sockets/socketServer");
const liveDriverPositions = () => require("../../services/liveDriverPositions");
const adminSocket = () => require("../../sockets/adminSocket");

const DRIVER_CANCEL_REASON = "Cancelled by driver on WhatsApp";
const OTP_RE = /^\d{4,6}$/;
// Same as the driver app: a driver may cancel only before pickup is complete.
const CANCELLABLE_STEPS = new Set(["go_pickup", "pickup_otp", "loading"]);
const EARLY_DROP_STEPS = new Set(["at_drop", "drop_otp"]);
// Same messages orderController.orderStatusChangeLegacy shows for driverCancel's error codes.
const CANCEL_ERRORS = {
  ORDER_NOT_FOUND: "Order not found",
  NOT_ASSIGNED_DRIVER: "You are not assigned to this order",
  ORDER_NOT_CANCELLABLE: "Order can no longer be cancelled",
};

// Same cash test tripLifecycle.updateStatus uses when it decides a settlement is due.
const isCashBooking = (order) =>
  Number(order.p_method_id) === 2 || Number(order.p_method_id) === 0 || String(order.trans_id || "").toLowerCase().startsWith("cash");

/** "  paisa  mila " -> "PAISAMILA", "48 21" -> "4821". */
const normalizeReply = (text) => String(text ?? "").trim().toUpperCase().replace(/\s+/g, "");

async function loadContext(orderId) {
  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (!order) return null;
  const session = await prisma.whatsapp_driver_session.findUnique({ where: { order_id: orderId } });
  // The session remembers which driver this conversation belongs to, so a cancel / re-live (rid back to 0) or a
  // reassignment is seen as "this driver's order is gone" instead of acting for whoever holds it now.
  const riderId = Number(session?.rider_id || order.rid) || 0;
  const [rider, stops, progress, timer, settlement] = await Promise.all([
    riderId
      ? prisma.tbl_rider.findUnique({
          where: { id: riderId },
          select: { id: true, fmobile: true, full_name: true, rlats: true, rlongs: true, rloc_updated_at: true },
        })
      : null,
    prisma.pkg_order_stops.findMany({ where: { order_id: orderId }, orderBy: [{ sequence: "asc" }, { id: "asc" }] }),
    prisma.driver_trip_progress.findUnique({ where: { order_id: orderId } }),
    riderId ? prisma.pkg_order_wait_timer.findUnique({ where: { order_id_rid: { order_id: orderId, rid: riderId } } }) : null,
    order.o_status === "Completed" ? prisma.order_settlement.findUnique({ where: { order_id: orderId } }) : null,
  ]);
  const dropOtpRequired = Number(order.order_status) === 3 ? await dropOtp().isRequired(order) : false;
  const assignedToRider = riderId > 0 && Number(order.rid) === riderId;
  const step = assignedToRider
    ? resolveStep({ order, progress, stops, timer, dropOtpRequired, settlement })
    : { key: "cancelled" };
  return { order, rider, riderId, stops, progress, timer, dropOtpRequired, settlement, session, step };
}

/** The driver's last known position, only when fresh (same 2-minute rule as dispatch); otherwise omitted. */
function freshLocation(rider) {
  if (!rider?.rloc_updated_at) return { lat: undefined, lng: undefined };
  if (Date.now() - new Date(rider.rloc_updated_at).getTime() > RIDER_LOCATION_FRESHNESS_MS) return { lat: undefined, lng: undefined };
  const lat = Number(rider.rlats), lng = Number(rider.rlongs);
  if (rider.rlats == null || rider.rlongs == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: undefined, lng: undefined };
  return { lat, lng };
}

/**
 * The single step -> backend-call mapping, shared by the driver's replies and the executive's "next step" override.
 * Input: { reply } (the driver's normalized text) or { advance: true, otp } (do this step's action; otp for an OTP
 * step). null = nothing to do on this step.
 */
function planFor(step, { reply, advance = false, otp } = {}) {
  const tapped = (token) => advance || reply === token;
  const code = advance ? normalizeReply(otp) : reply;
  switch (step.key) {
    case "go_pickup": return tapped("1") ? { status: "arrived" } : null;
    case "pickup_otp": return OTP_RE.test(code) ? { verifyOtp: code } : null;
    case "loading": return tapped("2") ? { status: "pickup" } : null;
    case "go_stop": return tapped("3") ? { status: `arrived_stop_${step.stopNumber}` } : null;
    case "at_stop": return tapped("4") ? { status: `complete_stop_${step.stopNumber}` } : null;
    case "go_drop": return tapped("5") ? { status: "arrived_drop" } : null;
    case "at_drop": return tapped("6") ? { status: "complete" } : null;
    case "drop_otp": return OTP_RE.test(code) ? { status: "complete", dropOtp: code } : null;
    case "await_cash": return tapped("PAISAMILA") ? { cashReceived: true } : null;
    default: return null;
  }
}

async function runPlan(ctx, plan, earlyDrop) {
  const orderId = ctx.order.id;
  const riderId = ctx.riderId;
  try {
    if (plan.cashReceived) {
      const result = await settlementService().markCashReceived({ orderId, riderId });
      return { type: "advanced", result };
    }
    if (plan.verifyOtp) {
      const { lat, lng } = freshLocation(ctx.rider);
      const result = await driverTripService().progressTrip({ orderId, riderId, action: "verify_otp", otp: plan.verifyOtp, lat, lng });
      return { type: "advanced", result };
    }
    let opts = {};
    if (plan.status === "complete") {
      opts = { ...freshLocation(ctx.rider), dropOtp: plan.dropOtp, ...(earlyDrop ? { earlyDrop: true } : {}) };
    }
    const result = await tripLifecycle().updateStatus(orderId, riderId, plan.status, opts);
    if (result?.early_drop_required) return { type: "early_drop_required", result, dropOtp: plan.dropOtp ?? null };
    if (!result?.success) return { type: "refused", msg: result?.msg };
    return { type: "advanced", result };
  } catch (err) {
    // A 409 from progressTrip, or a SettlementError (wrong state / not this driver's payment), is a refusal.
    if (err?.statusCode || err?.name === "SettlementError") return { type: "refused", msg: err.message };
    throw err;
  }
}

/**
 * Runs the backend call for the context's CURRENT step - the one entry point for both the driver's WhatsApp reply
 * and the executive's override, so both always do exactly what the driver app would.
 * input: { reply, earlyDrop } or { advance: true, otp, earlyDrop }.
 * Returns { type: 'invalid' } | { type: 'refused', msg } | { type: 'early_drop_required', result, dropOtp } |
 *         { type: 'advanced', result, plan }.
 * A step that advanced drops any pending CANCEL / early-drop confirmation: it was asked about an earlier step.
 */
async function performStepAction(ctx, input = {}) {
  const plan = planFor(ctx.step, input);
  if (!plan) return { type: "invalid" };
  const outcome = await runPlan(ctx, plan, Boolean(input.earlyDrop));
  if (outcome.type === "advanced") {
    await updateSession(ctx.order.id, { pending_confirm: null, pending_otp: null });
    return { ...outcome, plan };
  }
  return outcome;
}

async function updateSession(orderId, data) {
  await prisma.whatsapp_driver_session.updateMany({ where: { order_id: orderId }, data });
}

async function completionMessage(ctx) {
  const { order, settlement } = ctx;
  const cashPending = isCashSettlementPending(settlement);
  let walletCredit = null;
  if (!cashPending && !isCashBooking(order)) {
    // Exactly what tripLifecycle credited for a wallet-paid order (fare minus commission), if anything.
    const credit = await prisma.tbl_wallet_history.findFirst({
      where: { payment_id: `wallet_order_credit:${order.id}`, type: "credit", wallet_type: "driver" },
    });
    walletCredit = credit ? Number(credit.amount) : null;
  }
  const amountDue = cashPending ? cashPayable(settlement) : null;
  return messages.join(
    messages.completed({ final_fare: order.total_dcharge, isCash: cashPending || isCashBooking(order), amountDue, walletCredit }),
    messages.appNudge()
  );
}

async function runStepAction(ctx, input) {
  const outcome = await performStepAction(ctx, input);
  if (outcome.type === "invalid") return { text: messages.invalidReply(ctx.step.key, ctx), step: ctx.step };
  if (outcome.type === "refused") return { text: messages.backendRefused(outcome.msg, ctx.step.key, ctx), step: ctx.step };
  if (outcome.type === "early_drop_required") {
    await updateSession(ctx.order.id, { pending_confirm: "early_drop", pending_otp: outcome.dropOtp });
    return { text: messages.earlyDropConfirm(outcome.result), step: ctx.step };
  }
  const next = await loadContext(ctx.order.id);
  if (outcome.plan.cashReceived) return { text: messages.join(messages.cashThanks(), messages.appNudge()), step: next.step };
  const justCompleted = ctx.order.o_status !== "Completed" && next.order.o_status === "Completed" && next.step.key !== "cancelled";
  return { text: justCompleted ? await completionMessage(next) : messages.stepPrompt(next.step.key, next), step: next.step };
}

async function driverCancelReply(ctx) {
  try {
    const result = await tripLifecycle().driverCancel(ctx.order.id, ctx.riderId, DRIVER_CANCEL_REASON);
    return result?.requires_admin_approval ? messages.cancelRequested() : messages.cancelled();
  } catch (err) {
    if (!CANCEL_ERRORS[err?.message]) logger.error(`whatsapp driver cancel failed for order ${ctx.order.id}:`, err);
    return messages.backendRefused(CANCEL_ERRORS[err?.message] || "Order cancel nahi ho saka", ctx.step.key, ctx);
  }
}

async function replyFor(ctx, word) {
  const { step, session } = ctx;
  const pending = session?.pending_confirm || null;

  if (word === "HAAN" && pending === "cancel" && CANCELLABLE_STEPS.has(step.key)) {
    await updateSession(ctx.order.id, { pending_confirm: null, pending_otp: null });
    const text = await driverCancelReply(ctx);
    // Records "cancelled" once the cancel went through, so a later notifyOrderChanged doesn't repeat it.
    const next = await loadContext(ctx.order.id);
    return { text, step: next?.step };
  }
  if (word === "HAAN" && pending === "early_drop" && EARLY_DROP_STEPS.has(step.key)) {
    const reply = step.key === "drop_otp" ? session.pending_otp : "6";
    await updateSession(ctx.order.id, { pending_confirm: null, pending_otp: null });
    return runStepAction(ctx, { reply, earlyDrop: true });
  }
  // Any other reply drops a pending confirmation: HAAN only ever confirms the question asked just before it.
  if (pending || session?.pending_otp) await updateSession(ctx.order.id, { pending_confirm: null, pending_otp: null });

  if (step.key === "cancelled") return { text: messages.cancelled(), step };
  if (step.key === "done") return { text: messages.appNudge(), step };
  if (word === "0" || word === "HELP") return { text: messages.stepPrompt(step.key, ctx), step };
  if (word === "CANCEL" && CANCELLABLE_STEPS.has(step.key)) {
    await updateSession(ctx.order.id, { pending_confirm: "cancel" });
    return { text: messages.cancelConfirm(), step };
  }
  return runStepAction(ctx, { reply: word });
}

/** Handles one WhatsApp message from the order's driver; returns the reply text (the caller sends it). */
async function handleDriverReply({ orderId, riderId, text }) {
  const ctx = await loadContext(orderId);
  if (!ctx) return messages.cancelled();
  if (Number(riderId) !== ctx.riderId) return messages.cancelled();
  const now = new Date();
  await updateSession(orderId, { last_reply_at: now });
  const { text: reply, step } = await replyFor(ctx, normalizeReply(text));
  // The reply carries this step's instruction, so the proactive sender must not repeat it.
  if (step) await updateSession(orderId, { last_step: stepId(step), last_prompt_at: now });
  return reply;
}

/** First message after a WhatsApp assign: order card + the current step. Returns whether it was sent. */
async function startOrder(orderId) {
  const order = await prisma.pkg_order.findUnique({ where: { id: orderId }, select: { id: true, rid: true, city_id: true, driver_channel: true } });
  if (!order || order.driver_channel !== "whatsapp" || !order.rid) return false;
  const rider = await prisma.tbl_rider.findUnique({ where: { id: order.rid }, select: { id: true, fmobile: true } });
  if (!rider) return false;
  // (Re)binds the conversation to the order's assigned driver; a reassignment starts with a clean session.
  // created_at = when this driver was bound: it bounds how long a cancelled order still routes to the flow.
  const phone = normalizeToLast10Digits(rider.fmobile);
  await prisma.whatsapp_driver_session.upsert({
    where: { order_id: orderId },
    create: { order_id: orderId, rider_id: order.rid, phone },
    update: {
      rider_id: order.rid, phone, pending_confirm: null, pending_otp: null, last_step: null, last_prompt_at: null, alerted_step: null,
      created_at: new Date(),
    },
  });
  const ctx = await loadContext(orderId);
  if (!ctx || !ctx.rider) return false;
  const sent = await notifications().sendWhatsAppNotification(
    ctx.rider.fmobile,
    messages.join(messages.orderCard(ctx.order, ctx.stops, ctx.rider), messages.stepPrompt(ctx.step.key, ctx))
  );
  if (sent) await updateSession(orderId, { last_step: stepId(ctx.step), last_prompt_at: new Date() });
  else {
    logger.warn(`whatsapp startOrder: order card not delivered for order ${orderId}`);
    try {
      adminSocket().notifyDispatchAlert(orderId, order.city_id,
        `WhatsApp order message could not be sent to the driver of order #${orderId}. Call the driver.`, { kind: "whatsapp_send_failed" });
    } catch (err) {
      logger.error(`whatsapp startOrder: send-failed alert not raised for order ${orderId}:`, err);
    }
  }
  return sent;
}

/**
 * Proactively tells the driver the current step after a change made elsewhere (app, Live Location auto-arrival,
 * executive, customer). Skips a step the driver was already told about unless reason === 'changed' (the step is the
 * same but its details changed, e.g. a new pickup address). Returns whether a message was sent.
 */
async function sendCurrentStep(orderId, { reason } = {}) {
  const ctx = await loadContext(orderId);
  if (!ctx || !ctx.rider || !(await isWhatsappDriver(ctx.order, ctx.session))) return false;
  const id = stepId(ctx.step);
  if (ctx.session?.last_step === id && reason !== "changed") return false;
  return sendAndRecord(ctx, messages.stepPrompt(ctx.step.key, ctx), id);
}

/**
 * After a bot outage: tells the WhatsApp driver the bot is back and repeats the current step (even if it was sent
 * before the outage - replies sent meanwhile may have been lost). Skips cancelled / finished orders. Returns whether
 * a message was sent.
 */
async function resumeAfterReconnect(orderId) {
  const ctx = await loadContext(orderId);
  if (!ctx || !ctx.rider || !(await isWhatsappDriver(ctx.order, ctx.session))) return false;
  if (["cancelled", "done", "unknown"].includes(ctx.step.key)) return false;
  return sendAndRecord(ctx, messages.join(messages.botBackOnline(), messages.stepPrompt(ctx.step.key, ctx)), stepId(ctx.step));
}

/** Sends one message to the context's driver; only a delivered message is recorded as the step they were told. */
async function sendAndRecord(ctx, text, id) {
  const sent = await notifications().sendWhatsAppNotification(ctx.rider.fmobile, text);
  if (sent) await updateSession(ctx.order.id, { last_step: id, last_prompt_at: new Date() });
  return Boolean(sent);
}

const COMPLETED_STEPS = new Set(["done", "await_cash"]);

/**
 * The order changed outside this flow (driver app, executive, customer, a timeout sweep) - tell the WhatsApp driver.
 * kind: 'progress' -> the current step (onlyNewStep: skip it when it is the step the driver was last told, for
 * callers that cannot tell whether anything changed, e.g. the app's periodic trip sync); a newly completed order gets
 * the completion summary instead, once. 'route_changed' -> the order card again (new pickup / drop / stop) + the
 * current step. 'cancelled' -> cancelled(), once. A cancelled order is only ever told it is cancelled, once.
 * No-op unless the order is a WhatsApp-channel order. Step / route messages go only while the order's driver is the
 * WhatsApp driver (isWhatsappDriver): after a re-live the next driver may run it from the app. The cancelled notice
 * goes to the session's (old) driver. Fire-and-forget: never throws (errors are logged), resolves to
 * whether a message was sent.
 */
async function notifyOrderChanged(orderId, { kind, onlyNewStep = false } = {}) {
  try {
    const id = Number(orderId);
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    // Cheap check first: this runs on every app-channel status change too.
    const head = await prisma.pkg_order.findUnique({ where: { id }, select: { driver_channel: true } });
    if (head?.driver_channel !== "whatsapp") return false;
    const ctx = await loadContext(id);
    if (!ctx || !ctx.rider) return false;
    const lastStep = ctx.session?.last_step ?? null;

    if (ctx.step.key === "cancelled") {
      if (lastStep === "cancelled") return false;
      return await sendAndRecord(ctx, messages.cancelled(), "cancelled");
    }
    if (kind === "cancelled") return false; // the order is still this driver's: nothing was cancelled for them
    if (!(await isWhatsappDriver(ctx.order, ctx.session))) return false;
    const current = stepId(ctx.step);
    if (kind === "route_changed") {
      const text = messages.join(messages.orderCard(ctx.order, ctx.stops, ctx.rider, { updated: true }), messages.stepPrompt(ctx.step.key, ctx));
      return await sendAndRecord(ctx, text, current);
    }
    if (kind !== "progress") return false;
    if (COMPLETED_STEPS.has(ctx.step.key)) {
      if (lastStep === current) return false;
      // Already told it was completed (e.g. await_cash -> done after the cash was settled elsewhere): just the step.
      if (COMPLETED_STEPS.has(lastStep)) return await sendAndRecord(ctx, messages.stepPrompt(ctx.step.key, ctx), current);
      return await sendAndRecord(ctx, await completionMessage(ctx), current);
    }
    if (onlyNewStep && lastStep === current) return false;
    return await sendAndRecord(ctx, messages.stepPrompt(ctx.step.key, ctx), current);
  } catch (err) {
    logger.error(`whatsapp notifyOrderChanged(${kind}) failed for order ${orderId}:`, err);
    return false;
  }
}

const isActiveTrip = (order) => [1, 2, 3].includes(Number(order.order_status)) && !["Completed", "Cancelled"].includes(order.o_status);

/** Same room + payload as trackingSocket's driver:location_ping, so the customer map moves the same way. */
function streamLocation(orderId, riderId, lat, lng) {
  try {
    socketServer().getIO().to(`order_${orderId}`).emit("driver:location_stream", { order_id: orderId, rider_id: riderId, lat, lng, heading: 0 });
  } catch (err) {
    logger.warn(`whatsapp driver location: stream for order ${orderId} not sent: ${err.message}`);
  }
}

/**
 * A location the order's driver shared on WhatsApp (pin or Live Location): stored like an app ping, streamed to the
 * customer, and fed to the trip sync, which may auto-arrive the driver - the new step is then sent to them.
 * Errors are logged, never thrown (the caller is the WhatsApp message loop).
 */
async function handleDriverLocation({ orderId, riderId, lat, lng, timestampMs }) {
  try {
    const la = Number(lat), lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return;
    const ctx = await loadContext(orderId);
    if (!ctx || Number(riderId) !== ctx.riderId || ctx.step.key === "cancelled" || !isActiveTrip(ctx.order)) return;
    const now = Date.now();
    const at = Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Math.min(Number(timestampMs), now) : now;

    // An older fix (e.g. a delayed WhatsApp delivery) must not move the driver back past a newer app/WhatsApp ping.
    const storedAt = ctx.rider?.rloc_updated_at ? new Date(ctx.rider.rloc_updated_at).getTime() : 0;
    if (at >= storedAt) {
      await prisma.tbl_rider.update({
        where: { id: ctx.riderId },
        data: { rlats: String(la), rlongs: String(lo), rloc_updated_at: new Date(at) },
      });
      liveDriverPositions().record(ctx.riderId, la, lo, 0, at);
      streamLocation(orderId, ctx.riderId, la, lo);
    }
    await updateSession(orderId, { last_location_at: new Date(now) });

    await driverTripService().progressTrip({ orderId, riderId: ctx.riderId, action: "sync", samples: [{ lat: la, lng: lo, timestamp: at }] });
    const next = await loadContext(orderId);
    // No reason 'changed': a reply handled meanwhile may already have told the driver this step.
    if (next && stepId(next.step) !== stepId(ctx.step)) await sendCurrentStep(orderId);
  } catch (err) {
    logger.error(`whatsapp driver location failed for order ${orderId}:`, err);
  }
}

const OTP_STEPS = { pickup_otp: "Enter the pickup OTP", drop_otp: "Enter the drop OTP" };
// No forward action: the executive has nothing to push (a stuck 'unknown' step needs a call, not a guess).
const NOTHING_TO_ADVANCE = new Set(["cancelled", "done", "unknown"]);

/**
 * What the executive sees for an order's WhatsApp channel; null when the order doesn't exist. An order whose
 * WhatsApp driver is gone (re-live / replace: driver_channel still 'whatsapp') reads as an app order.
 */
async function statusForExecutive(orderId) {
  const head = await prisma.pkg_order.findUnique({ where: { id: orderId }, select: { id: true, rid: true, driver_channel: true } });
  if (!head) return null;
  const channel = (await isWhatsappDriver(head)) ? "whatsapp" : (head.driver_channel === "whatsapp" ? "app" : head.driver_channel || "app");
  if (channel !== "whatsapp") {
    return { channel, step: null, step_label: null, last_reply_at: null, last_location_at: null, last_prompt_at: null, needs_otp: false };
  }
  const ctx = await loadContext(orderId);
  if (!ctx) return null;
  const s = ctx.session;
  return {
    channel,
    step: stepId(ctx.step),
    step_label: stepLabel(ctx.step),
    last_reply_at: s?.last_reply_at ?? null,
    last_location_at: s?.last_location_at ?? null,
    last_prompt_at: s?.last_prompt_at ?? null,
    needs_otp: Boolean(OTP_STEPS[ctx.step.key]),
  };
}

/**
 * The executive's "next step" for a stuck WhatsApp driver: does exactly what the driver's next valid reply would
 * (performStepAction - the same step -> backend-call mapping), records it in order_status_history with the admin's
 * id, and tells the driver the new step (or the completion summary). An early drop is never confirmed from here:
 * the fare changes, so only the driver may agree to it.
 * Returns { ok: true, message, step, step_label } or { ok: false, status, message }.
 */
async function advanceAsExecutive({ orderId, admin, otp }) {
  const ctx = await loadContext(orderId);
  if (!ctx) return { ok: false, status: 404, message: "Order not found" };
  if (ctx.order.driver_channel !== "whatsapp") return { ok: false, status: 400, message: "This is not a WhatsApp order" };
  const { step } = ctx;
  if (NOTHING_TO_ADVANCE.has(step.key)) {
    const why = step.key === "unknown" ? "the order's step is unknown - call the driver" : `the order is ${stepLabel(step).toLowerCase()}`;
    return { ok: false, status: 409, message: `Nothing to advance: ${why}` };
  }
  if (OTP_STEPS[step.key]) {
    const code = normalizeReply(otp);
    if (!code) return { ok: false, status: 400, message: OTP_STEPS[step.key] };
    if (!OTP_RE.test(code)) return { ok: false, status: 400, message: "OTP must be 4 to 6 digits" };
  }

  const outcome = await performStepAction(ctx, { advance: true, otp });
  if (outcome.type === "invalid") return { ok: false, status: 409, message: "Nothing to advance on this step" };
  if (outcome.type === "refused") return { ok: false, status: 409, message: outcome.msg || "The step could not be done" };
  if (outcome.type === "early_drop_required") {
    const m = Math.round(Number(outcome.result?.distance_m) || 0);
    return {
      ok: false, status: 409,
      message: `Driver is ${m} m from the drop. Ending the trip here changes the fare, so only the driver can confirm it on WhatsApp.`,
    };
  }

  const doneStep = stepId(step);
  const next = await loadContext(orderId);
  try {
    await prisma.order_status_history.create({
      data: {
        order_id: orderId,
        rider_id: ctx.riderId || null,
        status: next?.order?.o_status || ctx.order.o_status,
        remark: `WhatsApp step '${doneStep}' done by executive #${admin?.id}`,
      },
    });
  } catch (err) {
    logger.error(`whatsapp advanceAsExecutive: history remark not written for order ${orderId}:`, err);
  }
  // Sends the new step, or the completion summary once when this completed the order.
  await notifyOrderChanged(orderId, { kind: "progress" });
  const nextStep = next?.step || step;
  return { ok: true, message: `Done: ${stepLabel(step)}`, step: stepId(nextStep), step_label: stepLabel(nextStep) };
}

module.exports = {
  loadContext, startOrder, handleDriverReply, handleDriverLocation, sendCurrentStep, notifyOrderChanged, performStepAction,
  statusForExecutive, advanceAsExecutive, resumeAfterReconnect,
};
