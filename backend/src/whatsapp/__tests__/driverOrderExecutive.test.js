// WhatsApp Trial Order, Task 8: the executive's view of a WhatsApp order and the manual "next step" override.
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  driver_trip_progress: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn() },
  order_settlement: { findUnique: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn() },
  order_status_history: { create: jest.fn() },
  whatsapp_driver_session: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../services/tripLifecycle", () => ({ updateStatus: jest.fn(), driverCancel: jest.fn() }));
jest.mock("../../services/driverTripService", () => ({ progressTrip: jest.fn() }));
jest.mock("../../services/settlementService", () => ({ markCashReceived: jest.fn() }));
jest.mock("../../services/dropOtp", () => ({ isRequired: jest.fn() }));
jest.mock("../notifications", () => ({ sendWhatsAppNotification: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../services/liveDriverPositions", () => ({ record: jest.fn() }));

const prisma = require("../../config/db");
const tripLifecycle = require("../../services/tripLifecycle");
const { progressTrip } = require("../../services/driverTripService");
const settlementService = require("../../services/settlementService");
const dropOtp = require("../../services/dropOtp");
const notifications = require("../notifications");
const adminSocket = require("../../sockets/adminSocket");
const messages = require("../driverOrder/messages");
const flow = require("../driverOrder/flow");

const ORDER_ID = 877;
const RIDER_ID = 55;
const ADMIN = { id: 12, role: "executive", username: "exec" };
let db;

beforeEach(() => {
  jest.resetAllMocks();
  db = {
    order: {
      id: ORDER_ID, rid: RIDER_ID, uid: 9, city_id: 3, order_status: 1, o_status: "Processing", driver_channel: "whatsapp",
      total_dcharge: 450, p_method_id: 2, trans_id: "cash", paddress: "MG Road", plat: "22.7", plong: "75.8",
      daddress: "Vijay Nagar", dlat: "22.75", dlong: "75.9", pick_name: "Amit", pmobile: "9000000001",
      drop_name: "Ravi", dmobile: "9000000002",
    },
    rider: { id: RIDER_ID, fmobile: "9876543210", full_name: "Sultan", rlats: "22.71", rlongs: "75.81", rloc_updated_at: null },
    stops: [],
    progress: null,
    settlement: null,
    session: {
      order_id: ORDER_ID, rider_id: RIDER_ID, phone: "9876543210", pending_confirm: null, pending_otp: null, last_step: "go_pickup",
      last_reply_at: new Date("2026-11-17T10:00:00Z"), last_location_at: new Date("2026-11-17T10:01:00Z"),
      last_prompt_at: new Date("2026-11-17T09:59:00Z"), created_at: new Date("2026-11-17T09:58:00Z"),
    },
  };
  prisma.pkg_order.findUnique.mockImplementation(async () => (db.order ? { ...db.order } : null));
  prisma.tbl_rider.findUnique.mockImplementation(async () => db.rider);
  prisma.pkg_order_stops.findMany.mockImplementation(async () => db.stops);
  prisma.driver_trip_progress.findUnique.mockImplementation(async () => db.progress);
  prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
  prisma.order_settlement.findUnique.mockImplementation(async () => db.settlement);
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.order_status_history.create.mockResolvedValue({});
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

const advance = (extra = {}) => flow.advanceAsExecutive({ orderId: ORDER_ID, admin: ADMIN, ...extra });
const ctxFor = () => flow.loadContext(ORDER_ID);
const sentTexts = () => notifications.sendWhatsAppNotification.mock.calls.map(([, text]) => text);

describe("statusForExecutive", () => {
  it("returns the channel, current step + label and the session times", async () => {
    expect(await flow.statusForExecutive(ORDER_ID)).toEqual({
      channel: "whatsapp",
      step: "go_pickup",
      step_label: "Going to pickup",
      last_reply_at: db.session.last_reply_at,
      last_location_at: db.session.last_location_at,
      last_prompt_at: db.session.last_prompt_at,
      needs_otp: false,
    });
  });

  it("an OTP step needs an OTP; a stop step names the stop", async () => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { stop_step: 0, otp_verified_at: null };
    expect(await flow.statusForExecutive(ORDER_ID)).toMatchObject({ step: "pickup_otp", needs_otp: true });

    Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
    db.progress = { stop_step: 0, otp_verified_at: new Date() };
    db.stops = [{ id: 1, address: "Stop A" }];
    expect(await flow.statusForExecutive(ORDER_ID)).toMatchObject({ step: "go_stop:1", step_label: "Going to stop 1", needs_otp: false });
  });

  it("an app-channel order has no WhatsApp step", async () => {
    db.order.driver_channel = "app";
    expect(await flow.statusForExecutive(ORDER_ID)).toEqual({
      channel: "app", step: null, step_label: null, last_reply_at: null, last_location_at: null, last_prompt_at: null, needs_otp: false,
    });
  });

  it("a missing order is null", async () => {
    db.order = null;
    expect(await flow.statusForExecutive(ORDER_ID)).toBeNull();
  });

  it("a re-lived order an app driver now holds reads as an app order, though driver_channel still says 'whatsapp'", async () => {
    Object.assign(db.order, { rid: 99, order_status: 2, o_status: "Pickup" }); // session stays with the old driver 55
    expect(await flow.statusForExecutive(ORDER_ID)).toEqual({
      channel: "app", step: null, step_label: null, last_reply_at: null, last_location_at: null, last_prompt_at: null, needs_otp: false,
    });
    Object.assign(db.order, { rid: 0, order_status: 0, o_status: "Pending" }); // re-searching: no driver yet
    expect(await flow.statusForExecutive(ORDER_ID)).toMatchObject({ channel: "app", step: null });
  });
});

describe("advanceAsExecutive", () => {
  it("go_pickup -> updateStatus 'arrived', history remark with the admin id, driver gets the new step", async () => {
    tripLifecycle.updateStatus.mockImplementation(async () => {
      Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
      db.progress = { stop_step: 0, otp_verified_at: null };
      return { success: true, order_status: 2 };
    });
    const out = await advance();
    expect(tripLifecycle.updateStatus).toHaveBeenCalledWith(ORDER_ID, RIDER_ID, "arrived", {});
    expect(prisma.order_status_history.create).toHaveBeenCalledWith({
      data: { order_id: ORDER_ID, rider_id: RIDER_ID, status: "Pickup", remark: "WhatsApp step 'go_pickup' done by executive #12" },
    });
    expect(sentTexts()).toEqual([messages.stepPrompt("pickup_otp", await ctxFor())]);
    expect(db.session.last_step).toBe("pickup_otp");
    expect(out).toMatchObject({ ok: true, step: "pickup_otp", step_label: "At pickup - waiting for pickup OTP" });
  });

  it("pickup_otp without an OTP -> 400 'Enter the pickup OTP', no backend call", async () => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { stop_step: 0, otp_verified_at: null };
    expect(await advance()).toEqual({ ok: false, status: 400, message: "Enter the pickup OTP" });
    expect(await advance({ otp: "  " })).toEqual({ ok: false, status: 400, message: "Enter the pickup OTP" });
    expect(await advance({ otp: "12ab" })).toEqual({ ok: false, status: 400, message: "OTP must be 4 to 6 digits" });
    expect(progressTrip).not.toHaveBeenCalled();
    expect(prisma.order_status_history.create).not.toHaveBeenCalled();
  });

  it("pickup_otp with an OTP -> verify_otp", async () => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { stop_step: 0, otp_verified_at: null };
    progressTrip.mockImplementation(async () => { db.progress.otp_verified_at = new Date(); return {}; });
    const out = await advance({ otp: "4821" });
    expect(progressTrip).toHaveBeenCalledWith(expect.objectContaining({ action: "verify_otp", otp: "4821", orderId: ORDER_ID, riderId: RIDER_ID }));
    expect(out).toMatchObject({ ok: true, step: "loading" });
  });

  it("drop_otp without an OTP -> 400 'Enter the drop OTP'", async () => {
    Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
    db.progress = { stop_step: 1, otp_verified_at: new Date() };
    dropOtp.isRequired.mockResolvedValue(true);
    expect(await advance()).toEqual({ ok: false, status: 400, message: "Enter the drop OTP" });
  });

  it("a backend refusal -> 409 with the backend's message, nothing recorded or sent", async () => {
    tripLifecycle.updateStatus.mockResolvedValue({ success: false, msg: "Driver is too far from pickup" });
    expect(await advance()).toEqual({ ok: false, status: 409, message: "Driver is too far from pickup" });
    expect(prisma.order_status_history.create).not.toHaveBeenCalled();
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("a 409 thrown by progressTrip is passed through", async () => {
    Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
    db.progress = { stop_step: 0, otp_verified_at: null };
    progressTrip.mockRejectedValue(Object.assign(new Error("Invalid pickup OTP"), { statusCode: 409 }));
    expect(await advance({ otp: "1111" })).toEqual({ ok: false, status: 409, message: "Invalid pickup OTP" });
  });

  it("early drop needed -> 409, only the driver can confirm it", async () => {
    Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
    db.progress = { stop_step: 1, otp_verified_at: new Date() };
    tripLifecycle.updateStatus.mockResolvedValue({ success: false, early_drop_required: true, distance_m: 850, old_fare: 450, new_fare: 380 });
    const out = await advance();
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(out.message).toMatch(/850 m from the drop/);
    expect(db.session.pending_confirm).toBeNull();
    expect(prisma.order_status_history.create).not.toHaveBeenCalled();
  });

  it("completing the order sends the completion summary, once", async () => {
    Object.assign(db.order, { order_status: 3, o_status: "On_Route" });
    db.progress = { stop_step: 1, otp_verified_at: new Date() };
    db.session.last_step = "at_drop";
    tripLifecycle.updateStatus.mockImplementation(async () => {
      Object.assign(db.order, { order_status: 5, o_status: "Completed" });
      db.settlement = { status: "pending", method: null, amount_due: 450 };
      return { success: true };
    });
    const out = await advance();
    expect(tripLifecycle.updateStatus).toHaveBeenCalledWith(ORDER_ID, RIDER_ID, "complete", expect.any(Object));
    expect(out).toMatchObject({ ok: true, step: "await_cash" });
    expect(sentTexts()).toHaveLength(1);
    expect(sentTexts()[0]).toContain("Order complete!");
    expect(prisma.order_status_history.create.mock.calls[0][0].data).toMatchObject({ status: "Completed", remark: "WhatsApp step 'at_drop' done by executive #12" });
  });

  it("await_cash -> markCashReceived", async () => {
    Object.assign(db.order, { order_status: 5, o_status: "Completed" });
    db.settlement = { status: "pending", method: null, amount_due: 450 };
    db.session.last_step = "await_cash";
    settlementService.markCashReceived.mockImplementation(async () => { db.settlement = { ...db.settlement, status: "settled", method: "cash" }; return {}; });
    const out = await advance();
    expect(settlementService.markCashReceived).toHaveBeenCalledWith({ orderId: ORDER_ID, riderId: RIDER_ID });
    expect(out).toMatchObject({ ok: true, step: "done" });
  });

  it.each([
    ["cancelled", { rid: 0, order_status: 4, o_status: "Cancelled" }, null],
    ["done", { order_status: 5, o_status: "Completed" }, null],
  ])("%s -> 409 'Nothing to advance', no backend call", async (_name, patch, settlement) => {
    Object.assign(db.order, patch);
    db.settlement = settlement;
    const out = await advance();
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(out.message).toMatch(/^Nothing to advance/);
    expect(tripLifecycle.updateStatus).not.toHaveBeenCalled();
    expect(settlementService.markCashReceived).not.toHaveBeenCalled();
  });

  it("an app-channel order -> 400; a missing order -> 404", async () => {
    db.order.driver_channel = "app";
    expect(await advance()).toEqual({ ok: false, status: 400, message: "This is not a WhatsApp order" });
    db.order = null;
    expect(await advance()).toEqual({ ok: false, status: 404, message: "Order not found" });
  });

  it("a failed history write does not turn a done step into an error", async () => {
    tripLifecycle.updateStatus.mockImplementation(async () => {
      Object.assign(db.order, { order_status: 2, o_status: "Pickup" });
      return { success: true };
    });
    prisma.order_status_history.create.mockRejectedValue(new Error("db down"));
    expect(await advance()).toMatchObject({ ok: true, step: "pickup_otp" });
  });
});

describe("startOrder delivery failure", () => {
  it("alerts the executive when the order card could not be sent", async () => {
    notifications.sendWhatsAppNotification.mockResolvedValue(false);
    expect(await flow.startOrder(ORDER_ID)).toBe(false);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(
      ORDER_ID, 3, expect.stringContaining(`order #${ORDER_ID}`), { kind: "whatsapp_send_failed" }
    );
  });

  it("no alert when it was sent", async () => {
    await flow.startOrder(ORDER_ID);
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });
});
