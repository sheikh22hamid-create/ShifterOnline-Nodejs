jest.mock("../../config/db", () => ({
  $executeRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  tbl_order_requests: { updateMany: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  pkg_order_wait_timer: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
}));

jest.mock("../dispatchManager", () => ({ stopDispatch: jest.fn() }));
jest.mock("../lockManager", () => ({ releaseLock: jest.fn() }));
jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn().mockResolvedValue({ pkg: {}, driverEarning: 42 }),
  getPackageById: jest.fn(),
}));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const lockManager = require("../lockManager");
const tripLifecycle = require("../tripLifecycle");

describe("tripLifecycle.acceptOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order.findUnique.mockResolvedValue({
      id: 297,
      delivery_type: 6,
      distance: 15.4,
    });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, first_name: "Deepak" });
  });

  it("succeeds and stops the dispatch cascade when the atomic UPDATE affects exactly one row", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(1);

    const result = await tripLifecycle.acceptOrder(297, 1);

    expect(result.success).toBe(true);
    expect(result.order.driver_earning).toBe(42);
    expect(lockManager.releaseLock).toHaveBeenCalledWith(1);
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(297, "accepted_by_other");
  });

  it("fails without touching dispatch state when the order was already taken", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0);

    const result = await tripLifecycle.acceptOrder(297, 2);

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
