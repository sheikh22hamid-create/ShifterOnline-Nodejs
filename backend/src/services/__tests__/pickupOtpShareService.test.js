jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findFirst: jest.fn() },
  driver_trip_progress: { findUnique: jest.fn() },
  pickup_otp_share: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../utils/pickupOtpTimeout", () => ({ getPickupOtpTimeoutMinutes: jest.fn().mockResolvedValue(10) }));
jest.mock("../dispatchManager", () => ({ emitDriverEvent: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const service = require("../pickupOtpShareService");

const NOW = Date.now();
const ORDER = { id: 100, uid: 3, rid: 7, order_status: 2, o_status: "Pickup", otp: 4321 };
const TIMER = { pickup_wait_start: new Date(NOW - 2 * 60000), pickup_wait_end: null, pickup_wait_banked_seconds: 0 };

beforeEach(() => {
  jest.resetAllMocks();
  require("../../utils/pickupOtpTimeout").getPickupOtpTimeoutMinutes.mockResolvedValue(10);
  prisma.pkg_order.findUnique.mockResolvedValue(ORDER);
  prisma.pkg_order_wait_timer.findFirst.mockResolvedValue(TIMER);
  prisma.driver_trip_progress.findUnique.mockResolvedValue(null);
  prisma.pickup_otp_share.findFirst.mockResolvedValue(null);
  prisma.pickup_otp_share.create.mockImplementation(async ({ data }) => ({ id: 55, status: "pending", attempts: 1, ...data }));
  prisma.pickup_otp_share.update.mockImplementation(async ({ data }) => ({ id: 55, rider_id: 7, status: data.status, attempts: 2 }));
  prisma.pickup_otp_share.updateMany.mockResolvedValue({ count: 1 });
});

describe("sessionOf", () => {
  it("is active only while the driver waits at the pickup inside the admin timeout", async () => {
    expect((await service.sessionOf(ORDER)).state).toBe("active");
  });
  it.each([
    ["driver still on the way", { ...ORDER, order_status: 1, o_status: "Processing" }, "not_arrived"],
    ["cancelled", { ...ORDER, o_status: "Cancelled", order_status: 4 }, "unavailable"],
    ["completed", { ...ORDER, o_status: "Completed", order_status: 5 }, "unavailable"],
    ["no driver", { ...ORDER, rid: 0 }, "unavailable"],
  ])("%s -> %s", async (_label, order, state) => {
    expect((await service.sessionOf(order)).state).toBe(state);
  });
  it("is verified once the OTP was verified, and closed once the admin timeout is used up (banked time counts)", async () => {
    prisma.driver_trip_progress.findUnique.mockResolvedValue({ otp_verified_at: new Date() });
    expect((await service.sessionOf(ORDER)).state).toBe("verified");
    prisma.driver_trip_progress.findUnique.mockResolvedValue(null);
    prisma.pkg_order_wait_timer.findFirst.mockResolvedValue({ ...TIMER, pickup_wait_banked_seconds: 9 * 60 });
    expect((await service.sessionOf(ORDER)).state).toBe("unavailable");
  });
  it("is not active while the wait clock is paused", async () => {
    prisma.pkg_order_wait_timer.findFirst.mockResolvedValue({ ...TIMER, pickup_wait_start: null });
    expect((await service.sessionOf(ORDER)).state).toBe("not_arrived");
  });
});

describe("share (customer taps Send OTP to Driver)", () => {
  it("refuses before the driver arrives, after verification, for another customer, and for a closed order, with the exact messages", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, order_status: 1, o_status: "Processing" });
    expect(await service.share({ uid: 3, orderId: 100 })).toEqual({ ok: false, msg: "You can send the OTP once the driver reaches the pickup location." });

    prisma.pkg_order.findUnique.mockResolvedValue(ORDER);
    prisma.driver_trip_progress.findUnique.mockResolvedValue({ otp_verified_at: new Date() });
    expect(await service.share({ uid: 3, orderId: 100 })).toEqual({ ok: false, msg: "Pickup OTP has already been verified." });

    prisma.driver_trip_progress.findUnique.mockResolvedValue(null);
    expect(await service.share({ uid: 99, orderId: 100 })).toEqual({ ok: false, msg: "OTP sharing is currently unavailable. Please try again." });

    prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, o_status: "Cancelled", order_status: 4 });
    expect(await service.share({ uid: 3, orderId: 100 })).toEqual({ ok: false, msg: "OTP sharing is currently unavailable. Please try again." });
    expect(prisma.pickup_otp_share.create).not.toHaveBeenCalled();
    expect(dispatchManager.emitDriverEvent).not.toHaveBeenCalled();
  });

  it("records the share, nudges only the assigned driver (without the OTP) and succeeds only once the driver app acknowledged", async () => {
    prisma.pickup_otp_share.findUnique.mockResolvedValue({ id: 55, status: "delivered" });
    const out = await service.share({ uid: 3, orderId: 100 });
    expect(out).toEqual({ ok: true, msg: "OTP sent to driver successfully." });
    expect(prisma.pickup_otp_share.create).toHaveBeenCalledWith({ data: { order_id: 100, rider_id: 7, uid: 3 } });
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(7, "pickup_otp:shared", { order_id: 100, share_id: 55 });
    expect(JSON.stringify(dispatchManager.emitDriverEvent.mock.calls)).not.toContain("4321");
  });

  it("an unacknowledged delivery (driver offline) is a failure for the customer, never a misleading success", async () => {
    jest.useFakeTimers();
    prisma.pickup_otp_share.findUnique.mockResolvedValue({ id: 55, status: "pending" });
    const pending = service.share({ uid: 3, orderId: 100 });
    await jest.advanceTimersByTimeAsync(7000);
    expect(await pending).toEqual({ ok: false, msg: "Unable to send OTP to driver. Please try again." });
    expect(prisma.pickup_otp_share.updateMany).toHaveBeenCalledWith({ where: { id: 55, status: "pending" }, data: { status: "failed" } });
    jest.useRealTimers();
  });

  it("a repeated tap reuses the cycle's row instead of creating another, and an already delivered share needs no new nudge", async () => {
    prisma.pickup_otp_share.findFirst.mockResolvedValue({ id: 55, rider_id: 7, status: "delivered" });
    expect(await service.share({ uid: 3, orderId: 100 })).toEqual({ ok: true, msg: "OTP sent to driver successfully." });
    expect(prisma.pickup_otp_share.create).not.toHaveBeenCalled();
    expect(dispatchManager.emitDriverEvent).not.toHaveBeenCalled();

    prisma.pickup_otp_share.findFirst.mockResolvedValue({ id: 55, rider_id: 7, status: "failed" });
    prisma.pickup_otp_share.findUnique.mockResolvedValue({ id: 55, status: "delivered" });
    expect((await service.share({ uid: 3, orderId: 100 })).ok).toBe(true);
    expect(prisma.pickup_otp_share.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { attempts: { increment: 1 }, status: "pending" } });
    expect(prisma.pickup_otp_share.create).not.toHaveBeenCalled();
  });

  it("only looks at shares since this waiting cycle started", async () => {
    prisma.pickup_otp_share.findUnique.mockResolvedValue({ id: 55, status: "delivered" });
    await service.share({ uid: 3, orderId: 100 });
    expect(prisma.pickup_otp_share.findFirst.mock.calls[0][0].where).toEqual({ order_id: 100, requested_at: { gte: TIMER.pickup_wait_start } });
  });
});

describe("driver side", () => {
  it("gives the OTP only to the order's own driver, only while the session is open and a share exists", async () => {
    prisma.pickup_otp_share.findFirst.mockResolvedValue({ id: 55, rider_id: 7, status: "pending" });
    expect(await service.pendingForDriver({ riderId: 7, orderId: 100 })).toEqual({ share_id: 55, order_id: 100, otp: "4321", delivered: false });
    expect(await service.pendingForDriver({ riderId: 8, orderId: 100 })).toBeNull();
    prisma.pickup_otp_share.findFirst.mockResolvedValue(null);
    expect(await service.pendingForDriver({ riderId: 7, orderId: 100 })).toBeNull();
    prisma.pickup_otp_share.findFirst.mockResolvedValue({ id: 55, rider_id: 7, status: "pending" });
    prisma.driver_trip_progress.findUnique.mockResolvedValue({ otp_verified_at: new Date() });
    expect(await service.pendingForDriver({ riderId: 7, orderId: 100 })).toBeNull();
  });

  it("acknowledge marks delivered for the right driver and order only, and is idempotent", async () => {
    prisma.pickup_otp_share.findUnique.mockResolvedValue({ id: 55, order_id: 100, rider_id: 7, status: "pending" });
    expect(await service.acknowledge({ riderId: 7, orderId: 100, shareId: 55 })).toBe(true);
    expect(prisma.pickup_otp_share.updateMany).toHaveBeenCalledWith({ where: { id: 55, status: { not: "delivered" } }, data: { status: "delivered", delivered_at: expect.any(Date) } });
    expect(await service.acknowledge({ riderId: 8, orderId: 100, shareId: 55 })).toBe(false);
    expect(await service.acknowledge({ riderId: 7, orderId: 101, shareId: 55 })).toBe(false);
    prisma.pickup_otp_share.updateMany.mockClear();
    prisma.pickup_otp_share.findUnique.mockResolvedValue({ id: 55, order_id: 100, rider_id: 7, status: "delivered" });
    expect(await service.acknowledge({ riderId: 7, orderId: 100, shareId: 55 })).toBe(true);
    expect(prisma.pickup_otp_share.updateMany).not.toHaveBeenCalled();
  });
});

describe("statusForCustomer and customerSharedThisCycle", () => {
  it("enables the button only while the session is active, and reports shared/delivered/verified", async () => {
    expect(await service.statusForCustomer(ORDER)).toEqual({ can_send: true, verified: false, shared: false, delivered: false });
    prisma.pickup_otp_share.findFirst.mockResolvedValue({ id: 55, status: "delivered" });
    expect(await service.statusForCustomer(ORDER)).toEqual({ can_send: true, verified: false, shared: true, delivered: true });
    expect(await service.statusForCustomer({ ...ORDER, order_status: 1, o_status: "Processing" })).toEqual({ can_send: false, verified: false, shared: false, delivered: false });
    prisma.driver_trip_progress.findUnique.mockResolvedValue({ otp_verified_at: new Date() });
    expect((await service.statusForCustomer(ORDER)).verified).toBe(true);
    expect((await service.statusForCustomer(ORDER)).can_send).toBe(false);
  });

  it("counts any share row of the cycle (even a failed one) and answers true if the check itself errors", async () => {
    prisma.pickup_otp_share.findFirst.mockResolvedValue({ id: 55, status: "failed" });
    expect(await service.customerSharedThisCycle(100, TIMER)).toBe(true);
    prisma.pickup_otp_share.findFirst.mockResolvedValue(null);
    expect(await service.customerSharedThisCycle(100, TIMER)).toBe(false);
    prisma.pickup_otp_share.findFirst.mockRejectedValue(new Error("db"));
    expect(await service.customerSharedThisCycle(100, TIMER)).toBe(true);
  });
});
