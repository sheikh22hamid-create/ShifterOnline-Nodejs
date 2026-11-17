jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  driver_trip_progress: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn() },
  order_settlement: { findUnique: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn() },
  whatsapp_driver_session: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../services/tripLifecycle", () => ({ updateStatus: jest.fn(), driverCancel: jest.fn() }));
jest.mock("../../services/driverTripService", () => ({ progressTrip: jest.fn() }));
jest.mock("../../services/settlementService", () => ({ markCashReceived: jest.fn() }));
jest.mock("../../services/dropOtp", () => ({ isRequired: jest.fn() }));
jest.mock("../notifications", () => ({ sendWhatsAppNotification: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));
jest.mock("../../services/liveDriverPositions", () => ({ record: jest.fn() }));

const prisma = require("../../config/db");
const tripLifecycle = require("../../services/tripLifecycle");
const { progressTrip } = require("../../services/driverTripService");
const settlementService = require("../../services/settlementService");
const dropOtp = require("../../services/dropOtp");
const notifications = require("../notifications");
const { getIO } = require("../../sockets/socketServer");
const liveDriverPositions = require("../../services/liveDriverPositions");
const messages = require("../driverOrder/messages");
const flow = require("../driverOrder/flow");

const ORDER_ID = 877;
const RIDER_ID = 55;
let db;

function seed(orderPatch = {}, extra = {}) {
  db = {
    order: {
      id: ORDER_ID, rid: RIDER_ID, uid: 9, order_status: 1, o_status: "Processing", driver_channel: "whatsapp",
      total_dcharge: 450, p_method_id: 2, trans_id: "cash", paddress: "MG Road", plat: "22.7", plong: "75.8",
      daddress: "Vijay Nagar", dlat: "22.75", dlong: "75.9", pick_name: "Amit", pmobile: "9000000001",
      drop_name: "Ravi", dmobile: "9000000002", otp: 4821, drop_otp: null,
      ...orderPatch,
    },
    rider: { id: RIDER_ID, fmobile: "9876543210", full_name: "Sultan", rlats: "22.71", rlongs: "75.81", rloc_updated_at: new Date(Date.now() - 30 * 1000) },
    stops: [],
    progress: null,
    timer: null,
    settlement: null,
    session: { order_id: ORDER_ID, rider_id: RIDER_ID, phone: "9876543210", pending_confirm: null, pending_otp: null, last_step: null },
    walletCredit: null,
    ...extra,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  seed();
  prisma.pkg_order.findUnique.mockImplementation(async () => (db.order ? { ...db.order } : null));
  prisma.tbl_rider.findUnique.mockImplementation(async () => db.rider);
  prisma.pkg_order_stops.findMany.mockImplementation(async () => db.stops);
  prisma.driver_trip_progress.findUnique.mockImplementation(async () => db.progress);
  prisma.pkg_order_wait_timer.findUnique.mockImplementation(async () => db.timer);
  prisma.order_settlement.findUnique.mockImplementation(async () => db.settlement);
  prisma.tbl_wallet_history.findFirst.mockImplementation(async () => db.walletCredit);
  prisma.whatsapp_driver_session.findUnique.mockImplementation(async () => db.session);
  prisma.whatsapp_driver_session.updateMany.mockImplementation(async ({ data }) => {
    if (db.session) Object.assign(db.session, data);
    return { count: db.session ? 1 : 0 };
  });
  prisma.whatsapp_driver_session.upsert.mockImplementation(async ({ create, update }) => {
    db.session = db.session ? Object.assign(db.session, update) : { ...create };
    return db.session;
  });
  dropOtp.isRequired.mockResolvedValue(false);
  notifications.sendWhatsAppNotification.mockResolvedValue(true);
});

const reply = (text) => flow.handleDriverReply({ orderId: ORDER_ID, riderId: RIDER_ID, text });
const ctxFor = async () => flow.loadContext(ORDER_ID);

describe("handleDriverReply", () => {
  it("go_pickup + 1 -> arrived, reply is the pickup-OTP prompt of the reloaded step", async () => {
    tripLifecycle.updateStatus.mockImplementation(async () => {
      Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
      db.progress = { stop_step: 0, otp_verified_at: null };
      return { success: true, order_status: 2 };
    });
    const text = await reply("1");
    expect(tripLifecycle.updateStatus).toHaveBeenCalledWith(ORDER_ID, RIDER_ID, "arrived", expect.any(Object));
    expect(text).toContain(messages.stepPrompt("pickup_otp", await ctxFor()));
    expect(db.session.last_reply_at).toBeInstanceOf(Date);
    expect(db.session.last_step).toBe("pickup_otp");
  });

  it("go_pickup + 5 -> no backend call, invalidReply", async () => {
    const text = await reply("5");
    expect(tripLifecycle.updateStatus).not.toHaveBeenCalled();
    expect(progressTrip).not.toHaveBeenCalled();
    expect(text).toBe(messages.invalidReply("go_pickup", await ctxFor()));
  });

  it("0 / HELP re-sends the current step prompt", async () => {
    const ctx = await ctxFor();
    expect(await reply("0")).toBe(messages.stepPrompt("go_pickup", ctx));
    expect(await reply(" help ")).toBe(messages.stepPrompt("go_pickup", ctx));
    expect(tripLifecycle.updateStatus).not.toHaveBeenCalled();
  });

  describe("pickup OTP", () => {
    beforeEach(() => {
      Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
      db.progress = { stop_step: 0, otp_verified_at: null };
    });

    it("sends the OTP with the fresh location (30 s old)", async () => {
      progressTrip.mockImplementation(async () => { db.progress.otp_verified_at = new Date(); return {}; });
      const text = await reply("4821");
      expect(progressTrip).toHaveBeenCalledWith(expect.objectContaining({
        orderId: ORDER_ID, riderId: RIDER_ID, action: "verify_otp", otp: "4821", lat: 22.71, lng: 75.81,
      }));
      expect(text).toContain(messages.stepPrompt("loading", await ctxFor()));
    });

    it("omits a stale location (5 min old)", async () => {
      db.rider.rloc_updated_at = new Date(Date.now() - 5 * 60 * 1000);
      progressTrip.mockResolvedValue({});
      await reply("4821");
      const args = progressTrip.mock.calls[0][0];
      expect(args.otp).toBe("4821");
      expect(args.lat).toBeUndefined();
      expect(args.lng).toBeUndefined();
    });

    it("a 409 refusal returns the backend message and the OTP prompt", async () => {
      progressTrip.mockRejectedValue(Object.assign(new Error("Invalid pickup OTP"), { statusCode: 409 }));
      const text = await reply("1111");
      expect(text).toContain("Invalid pickup OTP");
      expect(text).toContain(messages.stepPrompt("pickup_otp", await ctxFor()));
    });

    it("an unexpected error (no statusCode) is not swallowed as a refusal", async () => {
      progressTrip.mockRejectedValue(new Error("db down"));
      await expect(reply("4821")).rejects.toThrow("db down");
    });
  });

  it("loading + 2 -> pickup", async () => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { stop_step: 0, otp_verified_at: new Date() };
    tripLifecycle.updateStatus.mockImplementation(async () => { Object.assign(db.order, { order_status: 3, o_status: "On_Route" }); return { success: true }; });
    const text = await reply("2");
    expect(tripLifecycle.updateStatus).toHaveBeenCalledWith(ORDER_ID, RIDER_ID, "pickup", expect.any(Object));
    expect(text).toContain(messages.stepPrompt("go_drop", await ctxFor()));
  });

  it("stops: go_stop + 3 -> arrived_stop_1, at_stop + 4 -> complete_stop_1", async () => {
    Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
    db.stops = [{ id: 1, sequence: 1, address: "Palasia" }];
    db.progress = { stop_step: 0, otp_verified_at: new Date() };
    tripLifecycle.updateStatus.mockImplementation(async () => { db.progress.stop_step++; return { success: true }; });
    await reply("3");
    expect(tripLifecycle.updateStatus).toHaveBeenLastCalledWith(ORDER_ID, RIDER_ID, "arrived_stop_1", expect.any(Object));
    await reply("4");
    expect(tripLifecycle.updateStatus).toHaveBeenLastCalledWith(ORDER_ID, RIDER_ID, "complete_stop_1", expect.any(Object));
    const text = await reply("5");
    expect(tripLifecycle.updateStatus).toHaveBeenLastCalledWith(ORDER_ID, RIDER_ID, "arrived_drop", expect.any(Object));
    expect(text).toContain(messages.stepPrompt("at_drop", await ctxFor()));
  });

  it("a backend {success:false} refusal returns the backend message and the current step", async () => {
    Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
    db.progress = { stop_step: 0 };
    tripLifecycle.updateStatus.mockResolvedValue({ success: false, msg: "Finish the active stop first" });
    const text = await reply("5");
    expect(text).toContain("Finish the active stop first");
    expect(text).toContain(messages.stepPrompt("go_drop", await ctxFor()));
  });

  describe("early drop", () => {
    beforeEach(() => {
      Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
      db.progress = { stop_step: 1 };
    });

    it("at_drop + 6 -> early_drop_required -> pending; then haan -> complete with earlyDrop", async () => {
      tripLifecycle.updateStatus.mockResolvedValueOnce({ success: false, early_drop_required: true, distance_m: 900, old_fare: 450, new_fare: 300 });
      const first = await reply("6");
      expect(tripLifecycle.updateStatus).toHaveBeenCalledWith(ORDER_ID, RIDER_ID, "complete", expect.objectContaining({ lat: 22.71, lng: 75.81 }));
      expect(first).toBe(messages.earlyDropConfirm({ distance_m: 900, old_fare: 450, new_fare: 300 }));
      expect(db.session.pending_confirm).toBe("early_drop");

      tripLifecycle.updateStatus.mockImplementationOnce(async () => {
        Object.assign(db.order, { order_status: 5, o_status: "Completed", total_dcharge: 300 });
        db.settlement = { status: "pending", method: null, amount_due: 300 };
        return { success: true, order_status: 5, final_fare: 300 };
      });
      const second = await reply("haan");
      expect(tripLifecycle.updateStatus).toHaveBeenLastCalledWith(ORDER_ID, RIDER_ID, "complete", expect.objectContaining({ earlyDrop: true }));
      expect(db.session.pending_confirm).toBeNull();
      expect(second).toBe(messages.join(messages.completed({ final_fare: 300, isCash: true, amountDue: 300 }), messages.appNudge()));
    });

    it("drop_otp: the OTP just sent is replayed on HAAN", async () => {
      dropOtp.isRequired.mockResolvedValue(true);
      tripLifecycle.updateStatus.mockResolvedValueOnce({ success: false, early_drop_required: true, distance_m: 900, old_fare: 450, new_fare: 300 });
      await reply("7391");
      expect(tripLifecycle.updateStatus).toHaveBeenLastCalledWith(ORDER_ID, RIDER_ID, "complete", expect.objectContaining({ dropOtp: "7391" }));
      expect(db.session.pending_otp).toBe("7391");
      tripLifecycle.updateStatus.mockResolvedValueOnce({ success: false, msg: "x" });
      await reply("HAAN");
      expect(tripLifecycle.updateStatus).toHaveBeenLastCalledWith(ORDER_ID, RIDER_ID, "complete", expect.objectContaining({ dropOtp: "7391", earlyDrop: true }));
      expect(db.session.pending_otp).toBeNull();
    });

    it("HAAN without a pending confirm does nothing but re-prompt", async () => {
      const text = await reply("HAAN");
      expect(tripLifecycle.updateStatus).not.toHaveBeenCalled();
      expect(text).toBe(messages.invalidReply("at_drop", await ctxFor()));
    });
  });

  describe("cancel", () => {
    it("cancel then HAAN -> driverCancel", async () => {
      tripLifecycle.driverCancel.mockImplementation(async () => { Object.assign(db.order, { rid: 0, order_status: 4, o_status: "Cancelled" }); return {}; });
      expect(await reply("cancel")).toBe(messages.cancelConfirm());
      expect(db.session.pending_confirm).toBe("cancel");
      const text = await reply("HAAN");
      expect(tripLifecycle.driverCancel).toHaveBeenCalledWith(ORDER_ID, RIDER_ID, "Cancelled by driver on WhatsApp");
      expect(text).toBe(messages.cancelled());
      expect(db.session.pending_confirm).toBeNull();
    });

    it("cancel then 1 -> no cancel, arrived called, pending cleared", async () => {
      tripLifecycle.updateStatus.mockResolvedValue({ success: true });
      await reply("CANCEL");
      await reply("1");
      expect(tripLifecycle.driverCancel).not.toHaveBeenCalled();
      expect(tripLifecycle.updateStatus).toHaveBeenCalledWith(ORDER_ID, RIDER_ID, "arrived", expect.any(Object));
      expect(db.session.pending_confirm).toBeNull();
    });

    it("cancel needing admin approval says so", async () => {
      tripLifecycle.driverCancel.mockResolvedValue({ requires_admin_approval: true, refund_status: "cancel_requested" });
      await reply("cancel");
      expect(await reply("haan")).toBe(messages.cancelRequested());
    });

    it("a cancel refused by the backend shows its message", async () => {
      tripLifecycle.driverCancel.mockRejectedValue(new Error("ORDER_NOT_CANCELLABLE"));
      await reply("cancel");
      const text = await reply("haan");
      expect(text).toContain("Order can no longer be cancelled");
    });

    it("CANCEL after pickup is not offered", async () => {
      Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
      db.progress = { stop_step: 0 };
      const text = await reply("cancel");
      expect(db.session.pending_confirm).toBeNull();
      expect(text).toBe(messages.invalidReply("go_drop", await ctxFor()));
    });
  });

  it("completed cash order + paisa mila -> markCashReceived", async () => {
    Object.assign(db.order, { order_status: 5, o_status: "Completed" });
    db.settlement = { status: "pending", method: null, amount_due: 450 };
    settlementService.markCashReceived.mockImplementation(async () => { db.settlement.status = "cash_received"; return {}; });
    const text = await reply(" paisa  mila ");
    expect(settlementService.markCashReceived).toHaveBeenCalledWith({ orderId: ORDER_ID, riderId: RIDER_ID });
    expect(text).toBe(messages.join(messages.cashThanks(), messages.appNudge()));
  });

  it("completed online order -> appNudge, PAISA MILA does nothing", async () => {
    Object.assign(db.order, { order_status: 5, o_status: "Completed" });
    expect(await reply("paisa mila")).toBe(messages.appNudge());
    expect(settlementService.markCashReceived).not.toHaveBeenCalled();
  });

  it("cancelled order + 1 -> cancelled(), no backend call", async () => {
    Object.assign(db.order, { rid: 0, order_status: 4, o_status: "Cancelled" });
    expect(await reply("1")).toBe(messages.cancelled());
    expect(tripLifecycle.updateStatus).not.toHaveBeenCalled();
  });

  it("an order reassigned to another driver is cancelled for this driver", async () => {
    Object.assign(db.order, { rid: 99 });
    expect(await reply("1")).toBe(messages.cancelled());
    expect(tripLifecycle.updateStatus).not.toHaveBeenCalled();
  });

  it("app progressed the order to on-route meanwhile: '1' is not sent to the backend", async () => {
    Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
    db.progress = { stop_step: 0, otp_verified_at: new Date() };
    const text = await reply("1");
    expect(tripLifecycle.updateStatus).not.toHaveBeenCalled();
    expect(text).toBe(messages.invalidReply("go_drop", await ctxFor()));
  });
});

describe("startOrder", () => {
  it("creates the session and sends the order card + first step", async () => {
    db.session = null;
    const ok = await flow.startOrder(ORDER_ID);
    expect(ok).toBe(true);
    expect(prisma.whatsapp_driver_session.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { order_id: ORDER_ID },
      create: expect.objectContaining({ order_id: ORDER_ID, rider_id: RIDER_ID, phone: "9876543210" }),
    }));
    const [phone, text] = notifications.sendWhatsAppNotification.mock.calls[0];
    expect(phone).toBe("9876543210");
    const ctx = await ctxFor();
    expect(text).toBe(messages.join(messages.orderCard(db.order, [], db.rider), messages.stepPrompt("go_pickup", ctx)));
    expect(text.match(/Help: 9109114515/g)).toHaveLength(1);
    expect(db.session.last_step).toBe("go_pickup");
  });

  it("re-binding an existing session resets created_at (the cancelled-notice window starts at this driver's assign)", async () => {
    db.session.created_at = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const before = Date.now();
    await flow.startOrder(ORDER_ID);
    expect(db.session.created_at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("does nothing for an app-channel order", async () => {
    db.order.driver_channel = "app";
    expect(await flow.startOrder(ORDER_ID)).toBe(false);
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });
});

describe("sendCurrentStep", () => {
  beforeEach(() => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { otp_verified_at: null };
  });

  it("sends the new step and records it", async () => {
    db.session.last_step = "go_pickup";
    await flow.sendCurrentStep(ORDER_ID, { reason: "progress" });
    expect(notifications.sendWhatsAppNotification).toHaveBeenCalledWith("9876543210", messages.stepPrompt("pickup_otp", await ctxFor()));
    expect(db.session.last_step).toBe("pickup_otp");
    expect(db.session.last_prompt_at).toBeInstanceOf(Date);
  });

  it("skips when the step was already sent, unless reason is 'changed'", async () => {
    db.session.last_step = "pickup_otp";
    await flow.sendCurrentStep(ORDER_ID, { reason: "progress" });
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
    await flow.sendCurrentStep(ORDER_ID, { reason: "changed" });
    expect(notifications.sendWhatsAppNotification).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for an app-channel order", async () => {
    db.order.driver_channel = "app";
    await flow.sendCurrentStep(ORDER_ID, { reason: "changed" });
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });
});

describe("handleDriverLocation", () => {
  let emit, to;
  const locate = (patch = {}) =>
    flow.handleDriverLocation({ orderId: ORDER_ID, riderId: RIDER_ID, lat: 22.7, lng: 75.8, timestampMs: Date.now(), ...patch });

  beforeEach(() => {
    emit = jest.fn();
    to = jest.fn(() => ({ emit }));
    getIO.mockReturnValue({ to });
    prisma.tbl_rider.update.mockResolvedValue({});
    progressTrip.mockResolvedValue({});
    db.session.last_step = "go_pickup";
  });

  it("stores the position, streams it to the order room, records the session and syncs the trip", async () => {
    const ts = Date.now() - 1000;
    await locate({ timestampMs: ts });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: RIDER_ID },
      data: { rlats: "22.7", rlongs: "75.8", rloc_updated_at: new Date(ts) },
    });
    expect(liveDriverPositions.record).toHaveBeenCalledWith(RIDER_ID, 22.7, 75.8, 0, ts);
    expect(to).toHaveBeenCalledWith(`order_${ORDER_ID}`);
    expect(emit).toHaveBeenCalledWith("driver:location_stream", { order_id: ORDER_ID, rider_id: RIDER_ID, lat: 22.7, lng: 75.8, heading: 0 });
    expect(db.session.last_location_at).toBeInstanceOf(Date);
    expect(progressTrip).toHaveBeenCalledWith({ orderId: ORDER_ID, riderId: RIDER_ID, action: "sync", samples: [{ lat: 22.7, lng: 75.8, timestamp: ts }] });
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("an auto-arrival from the sync sends the new step", async () => {
    progressTrip.mockImplementation(async () => {
      Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
      db.progress = { stop_step: 0, otp_verified_at: null };
      return {};
    });
    await locate();
    expect(notifications.sendWhatsAppNotification).toHaveBeenCalledWith("9876543210", messages.stepPrompt("pickup_otp", await ctxFor()));
    expect(db.session.last_step).toBe("pickup_otp");
  });

  it("an older fix than the stored one does not move the driver back, but still reaches the trip sync", async () => {
    const ts = new Date(db.rider.rloc_updated_at).getTime() - 60 * 1000;
    await locate({ timestampMs: ts });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(progressTrip).toHaveBeenCalledWith(expect.objectContaining({ samples: [{ lat: 22.7, lng: 75.8, timestamp: ts }] }));
  });

  it("a future timestamp is clamped to now", async () => {
    await locate({ timestampMs: Date.now() + 10 * 60 * 1000 });
    expect(progressTrip.mock.calls[0][0].samples[0].timestamp).toBeLessThanOrEqual(Date.now());
  });

  it("does nothing for invalid coordinates, another driver, or a finished order", async () => {
    await locate({ lat: "abc" });
    await locate({ lat: 95 });
    await locate({ riderId: 99 });
    Object.assign(db.order, { o_status: "Completed", order_status: 4 });
    await locate();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(progressTrip).not.toHaveBeenCalled();
  });

  it("errors are logged, never thrown (socket server down, sync refused)", async () => {
    getIO.mockImplementation(() => { throw new Error("Socket.io not initialized"); });
    progressTrip.mockRejectedValue(Object.assign(new Error("Trip belongs to a different driver"), { statusCode: 409 }));
    await expect(locate()).resolves.toBeUndefined();
    expect(prisma.tbl_rider.update).toHaveBeenCalled();
  });
});

describe("messages copy rules", () => {
  it("every message ends with the helpline line exactly once", async () => {
    const ctx = await ctxFor();
    const all = [
      messages.orderCard(db.order, [], db.rider),
      ...["go_pickup", "pickup_otp", "loading", "go_drop", "at_drop", "drop_otp", "await_cash", "done", "cancelled", "unknown"]
        .map((k) => messages.stepPrompt(k, ctx)),
      messages.invalidReply("go_pickup", ctx), messages.backendRefused("x", "go_pickup", ctx), messages.cancelConfirm(),
      messages.cancelled(), messages.cancelRequested(), messages.earlyDropConfirm({ distance_m: 900, old_fare: 450, new_fare: 300 }),
      messages.completed({ final_fare: 450, isCash: false, walletCredit: 405 }), messages.cashThanks(), messages.appNudge(),
    ];
    for (const m of all) {
      expect(m.endsWith("📞 Help: 9109114515")).toBe(true);
      expect(m.match(/Help: 9109114515/g)).toHaveLength(1);
    }
  });

  it("online completion names the wallet amount; the app nudge carries the link and login line", () => {
    expect(messages.completed({ final_fare: 450, isCash: false, walletCredit: 405 })).toContain("₹405 aapke Shifter wallet mein");
    const nudge = messages.appNudge();
    expect(nudge).toContain("https://play.google.com/store/apps/details?id=com.shifter.driver");
    expect(nudge).toContain("isi number se login karein, saare orders aur wallet app mein dikhenge");
  });
});

describe("performStepAction { advance: true } (shared with the executive override)", () => {
  it("go_pickup -> arrived, and drops a stale pending CANCEL", async () => {
    db.session.pending_confirm = "cancel";
    tripLifecycle.updateStatus.mockResolvedValue({ success: true });
    const outcome = await flow.performStepAction(await ctxFor(), { advance: true });
    expect(outcome.type).toBe("advanced");
    expect(tripLifecycle.updateStatus).toHaveBeenCalledWith(ORDER_ID, RIDER_ID, "arrived", {});
    expect(db.session.pending_confirm).toBeNull();
    expect(db.session.pending_otp).toBeNull();
  });

  it("pickup_otp -> verify_otp with the given otp; no otp is invalid", async () => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { otp_verified_at: null };
    progressTrip.mockResolvedValue({});
    expect((await flow.performStepAction(await ctxFor(), { advance: true })).type).toBe("invalid");
    expect(progressTrip).not.toHaveBeenCalled();
    const outcome = await flow.performStepAction(await ctxFor(), { advance: true, otp: "4821" });
    expect(outcome.type).toBe("advanced");
    expect(progressTrip).toHaveBeenCalledWith(expect.objectContaining({ action: "verify_otp", otp: "4821", orderId: ORDER_ID, riderId: RIDER_ID }));
  });

  it("await_cash -> markCashReceived", async () => {
    Object.assign(db.order, { order_status: 5, o_status: "Completed" });
    db.settlement = { status: "pending", method: null, amount_due: 450 };
    settlementService.markCashReceived.mockResolvedValue({});
    const outcome = await flow.performStepAction(await ctxFor(), { advance: true });
    expect(outcome.type).toBe("advanced");
    expect(settlementService.markCashReceived).toHaveBeenCalledWith({ orderId: ORDER_ID, riderId: RIDER_ID });
  });

  it("await_cash: a SettlementError is a refusal", async () => {
    Object.assign(db.order, { order_status: 5, o_status: "Completed" });
    db.settlement = { status: "pending", method: null, amount_due: 450 };
    settlementService.markCashReceived.mockRejectedValue(Object.assign(new Error("Payment is under dispute."), { name: "SettlementError" }));
    expect(await flow.performStepAction(await ctxFor(), { advance: true })).toEqual({ type: "refused", msg: "Payment is under dispute." });
  });

  it("a cancelled step has no action: invalid, no backend call", async () => {
    Object.assign(db.order, { rid: 0, order_status: 4, o_status: "Cancelled" });
    expect((await flow.performStepAction(await ctxFor(), { advance: true })).type).toBe("invalid");
    expect(tripLifecycle.updateStatus).not.toHaveBeenCalled();
  });
});

describe("receiver-pays cash amount", () => {
  it("completion message and await_cash prompt show the same payable amount (amount_due + receiver markup)", async () => {
    Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
    db.progress = { stop_step: 1 };
    tripLifecycle.updateStatus.mockImplementation(async () => {
      Object.assign(db.order, { order_status: 5, o_status: "Completed" });
      db.settlement = { status: "pending", method: null, amount_due: 400, payer: "receiver", receiver_markup: 20 };
      return { success: true };
    });
    const completedText = await reply("6");
    expect(completedText).toContain("₹420 cash lein");
    const prompt = messages.stepPrompt("await_cash", await ctxFor());
    expect(prompt).toContain("₹420 cash mila");
    expect(await reply("help")).toContain("₹420 cash mila");
  });
});

describe("last_step bookkeeping", () => {
  it("cancelled / done / PAISA MILA replies record the step so sendCurrentStep doesn't resend it", async () => {
    Object.assign(db.order, { order_status: 5, o_status: "Completed" });
    db.settlement = { status: "pending", method: null, amount_due: 450 };
    settlementService.markCashReceived.mockImplementation(async () => { db.settlement.status = "cash_received"; return {}; });
    await reply("paisa mila");
    expect(db.session.last_step).toBe("done");
    expect(await flow.sendCurrentStep(ORDER_ID, { reason: "progress" })).toBe(false);

    Object.assign(db.order, { rid: 0, order_status: 4, o_status: "Cancelled" });
    await reply("1");
    expect(db.session.last_step).toBe("cancelled");
    expect(await flow.sendCurrentStep(ORDER_ID, { reason: "progress" })).toBe(false);
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });
});

describe("notifyOrderChanged (changes made outside the WhatsApp flow)", () => {
  const notify = (kind, extra = {}) => flow.notifyOrderChanged(ORDER_ID, { kind, ...extra });
  const sent = () => notifications.sendWhatsAppNotification.mock.calls.map(([, text]) => text);

  it("is a no-op for an app-channel order", async () => {
    db.order.driver_channel = "app";
    for (const kind of ["progress", "route_changed", "cancelled"]) await notify(kind);
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("'cancelled' sends cancelled() once, a second notify sends nothing", async () => {
    Object.assign(db.order, { order_status: 4, o_status: "Cancelled" });
    await notify("cancelled");
    await notify("cancelled");
    expect(sent()).toEqual([messages.cancelled()]);
    expect(db.session.last_step).toBe("cancelled");
  });

  it("'cancelled' after the driver's own WhatsApp cancel sends nothing more", async () => {
    tripLifecycle.driverCancel.mockImplementation(async () => { Object.assign(db.order, { rid: 0, order_status: 0, o_status: "Pending" }); return {}; });
    await reply("cancel");
    expect(await reply("haan")).toBe(messages.cancelled());
    expect(db.session.last_step).toBe("cancelled");
    await notify("cancelled");
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("'cancelled' while the order is still this driver's (nothing cancelled for them) sends nothing", async () => {
    await notify("cancelled");
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("'route_changed' resends the order card with the new drop address + the current step", async () => {
    Object.assign(db.order, { order_status: 3, o_status: "On_Route", daddress: "Rau Circle" });
    db.progress = { stop_step: 0, otp_verified_at: new Date() };
    db.session.last_step = "go_drop";
    await notify("route_changed");
    const ctx = await ctxFor();
    expect(sent()).toEqual([messages.join(messages.orderCard(db.order, [], db.rider), messages.stepPrompt("go_drop", ctx))]);
    expect(sent()[0]).toContain("Rau Circle");
    expect(sent()[0].match(/Help: 9109114515/g)).toHaveLength(1);
  });

  it("'progress' sends the current step even when last_step is unchanged (reason 'changed')", async () => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { otp_verified_at: null };
    db.session.last_step = "pickup_otp";
    await notify("progress");
    expect(sent()).toEqual([messages.stepPrompt("pickup_otp", await ctxFor())]);
  });

  it("'progress' with onlyNewStep skips a step the driver was already told about, sends a new one", async () => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { otp_verified_at: null };
    db.session.last_step = "pickup_otp";
    await notify("progress", { onlyNewStep: true });
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
    db.progress.otp_verified_at = new Date();
    await notify("progress", { onlyNewStep: true });
    expect(sent()).toEqual([messages.stepPrompt("loading", await ctxFor())]);
    expect(db.session.last_step).toBe("loading");
  });

  it("'progress' after the order was completed elsewhere sends the completion summary once", async () => {
    db.session.last_step = "at_drop";
    Object.assign(db.order, { order_status: 5, o_status: "Completed" });
    db.settlement = { status: "pending", method: null, amount_due: 450 };
    await notify("progress");
    await notify("progress");
    expect(sent()).toEqual([messages.join(messages.completed({ final_fare: 450, isCash: true, amountDue: 450 }), messages.appNudge())]);
    expect(db.session.last_step).toBe("await_cash");
  });

  it("'progress' on a cancelled order tells the driver it is cancelled, once", async () => {
    Object.assign(db.order, { rid: 0, order_status: 4, o_status: "Cancelled" });
    await notify("progress");
    await notify("progress");
    expect(sent()).toEqual([messages.cancelled()]);
  });

  it("never throws: a failing loadContext / send is logged and swallowed", async () => {
    prisma.whatsapp_driver_session.findUnique.mockRejectedValue(new Error("db down"));
    await expect(notify("progress")).resolves.toBe(false);
    prisma.pkg_order.findUnique.mockRejectedValue(new Error("db down"));
    await expect(notify("cancelled")).resolves.toBe(false);
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("a failed send does not record the step", async () => {
    Object.assign(db.order, { order_status: 4, o_status: "Cancelled" });
    notifications.sendWhatsAppNotification.mockResolvedValue(false);
    await notify("cancelled");
    expect(db.session.last_step).toBeNull();
  });
});
