jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  order_cancel_request: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  driver_trip_progress: { deleteMany: jest.fn() },
  tbl_order_requests: { updateMany: jest.fn() },
  free_booking_order: { updateMany: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../tieredDispatchSettings", () => ({ getTierSettings: jest.fn() }));
jest.mock("../orderStageService", () => ({ getStage: jest.fn(), offeredRiderIds: jest.fn() }));
jest.mock("../tierPenaltyService", () => ({ applyCancelPenalty: jest.fn() }));
jest.mock("../driverOrderEventService", () => ({
  EVENTS: { CANCEL_REQUESTED: "cancel_requested", CANCELLED: "cancelled", CANCEL_REJECTED: "cancel_rejected" },
  logEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock("../orderSearchSettings", () => ({ getCitySettings: jest.fn() }));
jest.mock("../dispatchManager",() => ({ startDispatch: jest.fn().mockResolvedValue(), emitCustomerEvent: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyDriverCancelDecision: jest.fn().mockResolvedValue() }));

const prisma = require("../../config/db");
const settings = require("../tieredDispatchSettings");
const orderStage = require("../orderStageService");
const tierPenalty = require("../tierPenaltyService");
const events = require("../driverOrderEventService");
const orderSearchSettings = require("../orderSearchSettings");
const dispatchManager = require("../dispatchManager");
const svc = require("../cancelRequestService");

const ON = { tieredEnabled: true, penaltyEnabled: true, ladder: [5, 10, 20, 50, 100], cancelPenaltyPct: 100 };

beforeEach(() => {
  jest.clearAllMocks();
  settings.getTierSettings.mockResolvedValue(ON);
});

describe("gateDriverCancel", () => {
  const order = (o = {}) => ({ rid: 9, uid: 7, o_status: "Processing", ...o });

  it("tiered dispatch off: cancel works as before", async () => {
    settings.getTierSettings.mockResolvedValue({ ...ON, tieredEnabled: false });
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9, reason: "x" })).toEqual({ mode: "direct" });
  });

  it("an order accepted in the normal stage (or with no stage) cancels directly", async () => {
    orderStage.getStage.mockResolvedValue("normal");
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "direct" });
    orderStage.getStage.mockResolvedValue(null);
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "direct" });
  });

  it("a driver who is not the assigned one gets the normal 'not assigned' error path", async () => {
    orderStage.getStage.mockResolvedValue("free");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 4 }));
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "direct" });
  });

  it("a Free/Daily order before pickup creates a pending request and logs it", async () => {
    orderStage.getStage.mockResolvedValue("free");
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    prisma.order_cancel_request.findFirst.mockResolvedValue(null);
    prisma.order_cancel_request.create.mockResolvedValue({ id: 12 });
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9, reason: "breakdown" })).toEqual({ mode: "requested", requestId: 12 });
    expect(prisma.order_cancel_request.create).toHaveBeenCalledWith({
      data: { order_id: 50, rider_id: 9, tier: "free", reason: "breakdown", status: "pending" },
    });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "cancel_requested", tier: "free" }));
  });

  it("asking twice reuses the pending request", async () => {
    orderStage.getStage.mockResolvedValue("daily");
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    prisma.order_cancel_request.findFirst.mockResolvedValue({ id: 12 });
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "requested", requestId: 12, duplicate: true });
    expect(prisma.order_cancel_request.create).not.toHaveBeenCalled();
  });

  it("after pickup a Free/Daily driver cannot cancel at all", async () => {
    orderStage.getStage.mockResolvedValue("free");
    for (const o_status of ["Pickup", "On_Route", "Arrived_Drop"]) {
      prisma.pkg_order.findUnique.mockResolvedValue(order({ o_status }));
      expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "blocked" });
    }
  });

  it("an already cancelled or completed order falls through to the normal idempotent handling", async () => {
    orderStage.getStage.mockResolvedValue("free");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ o_status: "Cancelled" }));
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "direct" });
  });
});

describe("approve", () => {
  const request = { id: 12, order_id: 50, rider_id: 9, tier: "free", reason: "breakdown" };

  beforeEach(() => {
    prisma.order_cancel_request.updateMany.mockResolvedValue({ count: 1 });
    prisma.order_cancel_request.findUnique.mockResolvedValue(request);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.driver_trip_progress.deleteMany.mockResolvedValue({});
    prisma.tbl_order_requests.updateMany.mockResolvedValue({});
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, rid: 0, order_status: 0, allowed_delivery_types: "[6]" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "tok" });
    orderStage.offeredRiderIds.mockResolvedValue([9, 10]);
    tierPenalty.applyCancelPenalty.mockResolvedValue({ applied: true, penalty: { id: 70 }, amount: 100 });
    prisma.order_cancel_request.update.mockResolvedValue({});
  });

  it("takes the order off the driver, penalises, and restarts dispatch at the NEXT stage excluding earlier riders", async () => {
    const res = await svc.approve({ requestId: 12, adminId: 1 });
    expect(res).toMatchObject({ ok: true, nextStage: "daily" });
    expect(prisma.order_cancel_request.updateMany).toHaveBeenCalledWith({
      where: { id: 12, status: "pending" }, data: expect.objectContaining({ status: "approved", decided_by: 1 }),
    });
    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, rider_id: 9, status: "accepted" }, data: { status: "10" },
    });
    expect(tierPenalty.applyCancelPenalty).toHaveBeenCalledWith({ orderId: 50, riderId: 9, tier: "free" });
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalled();
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:driver_unassigned", { order_id: "50" });
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 50 }), null, { stage: "daily", earlierStageRiderIds: [9, 10] }
    );
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "cancelled", tier: "free" }));
  });

  it("a Daily driver's approved cancel goes on to the normal stage", async () => {
    prisma.order_cancel_request.findUnique.mockResolvedValue({ ...request, tier: "daily" });
    const res = await svc.approve({ requestId: 12, adminId: 1 });
    expect(res.nextStage).toBe("normal");
    expect(prisma.free_booking_order.updateMany).not.toHaveBeenCalled();
  });

  it("if the order state changed (driver already picked up / customer cancelled) nothing is re-dispatched or penalised", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    const res = await svc.approve({ requestId: 12, adminId: 1 });
    expect(res).toEqual({ ok: false, reason: "order_state_changed" });
    expect(tierPenalty.applyCancelPenalty).not.toHaveBeenCalled();
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
    expect(prisma.order_cancel_request.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { status: "stale" } });
  });

  it("deciding a request twice is a 409", async () => {
    prisma.order_cancel_request.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.approve({ requestId: 12, adminId: 1 })).rejects.toMatchObject({ statusCode: 409 });
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });

  describe("System 2 orders", () => {
    const system2 = { id: 50, uid: 7, rid: 0, order_status: 0, allowed_delivery_types: "[6]", city_id: 3, search_system: 2, search_deadline_at: new Date(Date.now() - 60_000) };

    beforeEach(() => {
      prisma.pkg_order.update.mockResolvedValue({});
      orderSearchSettings.getCitySettings.mockResolvedValue({ searchSystem: 2, driverSearchSeconds: 90 });
    });

    it("gives the re-dispatch a fresh search window, saved before dispatch starts", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(system2);
      const res = await svc.approve({ requestId: 12, adminId: 1 });
      expect(res.ok).toBe(true);
      expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(3);
      const [{ where, data }] = prisma.pkg_order.update.mock.calls[0];
      expect(where).toEqual({ id: 50 });
      expect(data.search_deadline_at).toBeInstanceOf(Date);
      expect(data.search_deadline_at.getTime()).toBeGreaterThan(Date.now());
      expect(prisma.pkg_order.update.mock.invocationCallOrder[0]).toBeLessThan(dispatchManager.startDispatch.mock.invocationCallOrder[0]);
      const passed = dispatchManager.startDispatch.mock.calls[0][0];
      expect(passed.search_deadline_at).toBe(data.search_deadline_at);
    });

    it("a non-System-2 order is left alone", async () => {
      await svc.approve({ requestId: 12, adminId: 1 });
      expect(prisma.pkg_order.update).not.toHaveBeenCalled();
      expect(orderSearchSettings.getCitySettings).not.toHaveBeenCalled();
    });

    it("still restarts dispatch if the window cannot be refreshed", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(system2);
      orderSearchSettings.getCitySettings.mockRejectedValue(new Error("boom"));
      const res = await svc.approve({ requestId: 12, adminId: 1 });
      expect(res.ok).toBe(true);
      expect(dispatchManager.startDispatch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("reject", () => {
  it("keeps the order with the driver, logs it and tells the driver", async () => {
    prisma.order_cancel_request.updateMany.mockResolvedValue({ count: 1 });
    prisma.order_cancel_request.findUnique.mockResolvedValue({ id: 12, order_id: 50, rider_id: 9, tier: "free" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "tok" });
    expect(await svc.reject({ requestId: 12, adminId: 1 })).toEqual({ ok: true });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "cancel_rejected" }));
    expect(require("../pushNotifier").notifyDriverCancelDecision).toHaveBeenCalledWith("tok", { orderId: 50, approved: false });
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });

  it("deciding twice is a 409", async () => {
    prisma.order_cancel_request.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.reject({ requestId: 12, adminId: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("listRequests", () => {
  it("scopes by city when one is given", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 12 }]);
    expect(await svc.listRequests({ status: "pending", cityId: 3 })).toEqual([{ id: 12 }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
