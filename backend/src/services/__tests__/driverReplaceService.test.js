jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), updateMany: jest.fn() },
  tbl_order_requests: { updateMany: jest.fn() },
  driver_trip_progress: { deleteMany: jest.fn() },
  pkg_order_wait_timer: { deleteMany: jest.fn() },
  driver_trip_event: { deleteMany: jest.fn() },
  order_status_history: { create: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../pricingEngine", () => ({ getPackageById: jest.fn().mockResolvedValue({ driver_earning: 20 }) }));
jest.mock("../walletAdvanceService", () => ({ refundWalletAdvanceIfAny: jest.fn().mockResolvedValue(0), applyKey: (id) => `advance_apply:${id}` }));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../tripLifecycle", () => ({ customerCancel: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitDriverEvent: jest.fn() }));
jest.mock("../driverCancelRelive", () => ({ afterRelive: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../pushNotifier", () => ({ notifyDriverCustomerCancelled: jest.fn().mockResolvedValue(undefined) }));

const prisma = require("../../config/db");
const walletAdvance = require("../walletAdvanceService");
const tripLifecycle = require("../tripLifecycle");
const relive = require("../driverCancelRelive");
const service = require("../driverReplaceService");

const ORDER = { id: 5, uid: 7, rid: 11, order_status: 1, o_status: "Processing", advance_payment: "30", payment_status: 1, delivery_type: 6, customise_order_id: null };

// $queryRaw answers by the SQL it is given (tagged template -> strings array).
function sql(handlers) {
  prisma.$queryRaw.mockImplementation(async (strings) => {
    const text = Array.isArray(strings) ? strings.join("?") : String(strings);
    for (const [needle, value] of handlers) if (text.includes(needle)) return typeof value === "function" ? value() : value;
    return [];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$executeRaw.mockResolvedValue(1);
  prisma.pkg_order.findUnique.mockResolvedValue(ORDER);
});

describe("replaceDriver - first time", () => {
  beforeEach(() => {
    sql([["FROM pkg_order WHERE id", [ORDER]], ["status = 'held' FOR UPDATE", [{ n: 0 }]], ["COUNT(*) AS n FROM order_driver_replacement", [{ n: 0 }]]]);
  });

  it("keeps the booking: releases the driver, records the held advance, never cancels or pays anyone", async () => {
    const out = await service.replaceDriver(7, 5);
    expect(out).toMatchObject({ success: true, replaced: true });
    expect(tripLifecycle.customerCancel).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled(); // the replaced driver gets nothing
    expect(prisma.tbl_user.update).not.toHaveBeenCalled(); // the customer is not charged
    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "10" } }));
    expect(prisma.order_status_history.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "Driver Replaced" }) });
    expect(relive.afterRelive).toHaveBeenCalledWith(expect.objectContaining({ orderId: 5, riderId: 11 }));
  });

  it("hands a wallet-paid advance back and retires that generation's ledger keys", async () => {
    await service.replaceDriver(7, 5);
    expect(walletAdvance.refundWalletAdvanceIfAny).toHaveBeenCalledWith(5, prisma);
    const retired = prisma.tbl_wallet_history.updateMany.mock.calls.map((c) => c[0].data.payment_id);
    expect(retired).toEqual(["advance_apply:5:replaced1", "advance_wallet_refund:5:replaced1"]);
  });

  it("does not touch the wallet when no advance was paid", async () => {
    sql([["FROM pkg_order WHERE id", [{ ...ORDER, payment_status: 0 }]], ["COUNT(*) AS n", [{ n: 0 }]]]);
    const out = await service.replaceDriver(7, 5);
    expect(out.success).toBe(true);
    expect(walletAdvance.refundWalletAdvanceIfAny).not.toHaveBeenCalled();
  });
});

describe("replaceDriver - refused", () => {
  it.each([
    ["someone else's order", { uid: 99 }],
    ["no driver yet", { rid: 0 }],
    ["trip already on its way", { order_status: 3, o_status: "On Route" }],
    ["already cancelled", { order_status: 4, o_status: "Cancelled" }],
    ["a Customise Order", { customise_order_id: 4 }],
  ])("%s", async (_n, patch) => {
    sql([["FROM pkg_order WHERE id", [{ ...ORDER, ...patch }]]]);
    const out = await service.replaceDriver(7, 5);
    expect(out.success).toBe(false);
    expect(prisma.tbl_order_requests.updateMany).not.toHaveBeenCalled();
    expect(tripLifecycle.customerCancel).not.toHaveBeenCalled();
  });
});

describe("replaceDriver - second time", () => {
  beforeEach(() => {
    sql([
      ["FROM pkg_order WHERE id", [{ ...ORDER, rid: 12 }]],
      ["status = 'held' FOR UPDATE", [{ n: 1 }]],
      ["SELECT id, rider_id, advance_amount", [{ id: 1, rider_id: 11, advance_amount: "30.00" }]],
    ]);
    tripLifecycle.customerCancel.mockResolvedValue({ success: true });
  });

  it("cancels the ride, reverses the first advance and pays the first driver once", async () => {
    const out = await service.replaceDriver(7, 5);
    expect(out).toMatchObject({ success: true, cancelled: true });
    expect(tripLifecycle.customerCancel).toHaveBeenCalledWith(7, 5, expect.any(String));
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 30 } } });
    const rows = prisma.tbl_wallet_history.create.mock.calls.map((c) => c[0].data);
    expect(rows).toEqual([
      expect.objectContaining({ type: "debit", amount: 30, wallet_type: "user", payment_id: "replace_advance_reverse:5:11" }),
      expect.objectContaining({ type: "credit", amount: 20, wallet_type: "driver", user_id: 11, payment_id: "replace_driver_comp:5:11" }),
    ]);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { wallet_balance: { increment: 20 } } });
  });

  it("a repeated request settles nothing twice (held row already claimed)", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    await service.replaceDriver(7, 5);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("settles nobody when the cancel itself is refused", async () => {
    tripLifecycle.customerCancel.mockResolvedValue({ success: false, msg: "Order cannot be cancelled" });
    const out = await service.replaceDriver(7, 5);
    expect(out.success).toBe(false);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("an advance of 0 reverses and pays nothing", async () => {
    sql([
      ["FROM pkg_order WHERE id", [{ ...ORDER, rid: 12 }]],
      ["status = 'held' FOR UPDATE", [{ n: 1 }]],
      ["SELECT id, rider_id, advance_amount", [{ id: 1, rider_id: 11, advance_amount: "0.00" }]],
    ]);
    await service.replaceDriver(7, 5);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
});
