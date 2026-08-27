jest.mock("../../config/db", () => ({
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  tbl_order_requests: { updateMany: jest.fn(), findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  pkg_order_wait_timer: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
}));

jest.mock("../dispatchManager", () => ({ stopDispatch: jest.fn() }));
jest.mock("../lockManager", () => ({ releaseLock: jest.fn() }));
jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn().mockResolvedValue({ pkg: {}, fare: 24.78, driverEarning: 42, commission: 5 }),
  getPackageById: jest.fn(),
}));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const lockManager = require("../lockManager");
const pricingEngine = require("../pricingEngine");
const tripLifecycle = require("../tripLifecycle");

describe("tripLifecycle.acceptOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // acceptOrder runs its two conditional UPDATEs inside prisma.$transaction(async (tx) => ...).
    // Passing the same mocked `prisma` as `tx` means `tx.$executeRaw` / `tx.tbl_order_requests.*`
    // hit the exact jest.fn()s these tests configure below.
    prisma.$transaction.mockImplementation((cb) => cb(prisma));

    prisma.pkg_order.findUnique.mockResolvedValue({
      id: 297,
      delivery_type: 6,
      distance: 15.4,
    });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, first_name: "Deepak" });
  });

  it("succeeds, prices from the accepted offer's own package, and stops the dispatch cascade", async () => {
    // First $executeRaw call claims the tbl_order_requests row, second claims pkg_order.
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, order_id: 297, rider_id: 1, package_id: 6, status: "accepted" });

    const result = await tripLifecycle.acceptOrder(297, 1);

    expect(result.success).toBe(true);
    expect(result.order.driver_earning).toBe(42);
    expect(result.order.delivery_type).toBe(6);
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 15.4);
    expect(lockManager.releaseLock).toHaveBeenCalledWith(1);
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(297, "accepted_by_other");
  });

  it("uses the accepted offer's package_id, not pkg_order.delivery_type which a later tier may have already overwritten", async () => {
    // pkg_order.delivery_type has already drifted to Model 2 (7) because a
    // later tier's batch ran before this Model-1 offer was accepted.
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 297, delivery_type: 7, distance: 15.4 });
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    // But the offer actually being accepted was for Model 1 (package 6).
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, order_id: 297, rider_id: 1, package_id: 6, status: "accepted" });

    const result = await tripLifecycle.acceptOrder(297, 1);

    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 15.4);
    expect(result.order.delivery_type).toBe(6);
  });

  it("fails with 'Offer expired' when the request is still 'sent' but past its freshness window", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0); // freshness/status WHERE clause didn't match
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, status: "sent" });

    const result = await tripLifecycle.acceptOrder(297, 2);

    expect(result).toEqual({ success: false, msg: "Offer expired" });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // pkg_order UPDATE never attempted
    expect(dispatchManager.stopDispatch).not.toHaveBeenCalled();
  });

  it("fails with 'Order already taken or cancelled' when the request row was already resolved another way", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, status: "timeout" });

    const result = await tripLifecycle.acceptOrder(297, 3);

    expect(result).toEqual({ success: false, msg: "Order already taken or cancelled" });
  });

  it("fails without touching dispatch state when the order was already taken (pkg_order UPDATE loses the race)", async () => {
    // The request claim succeeds (still fresh), but a different rider already won the order.
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, package_id: 6, status: "accepted" });

    const result = await tripLifecycle.acceptOrder(297, 4);

    expect(result).toEqual({ success: false, msg: "Order already taken or cancelled" });
    expect(dispatchManager.stopDispatch).not.toHaveBeenCalled();
  });
});

describe("tripLifecycle.customerCancel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stops dispatch when cancelling an unassigned order", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 297, uid: 7, rid: 0 });
    prisma.$executeRaw.mockResolvedValueOnce(1);

    const result = await tripLifecycle.customerCancel(7, 297, "changed my mind");

    expect(result).toEqual({ success: true });
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(297, "cancelled_by_user");
  });

  it("returns failure when the driver already won the accept race", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 297, uid: 7, rid: 1 });
    prisma.$executeRaw.mockResolvedValueOnce(0);

    const result = await tripLifecycle.customerCancel(7, 297, "too late");

    expect(result).toEqual({ success: false, msg: "Order cannot be cancelled" });
  });
});
