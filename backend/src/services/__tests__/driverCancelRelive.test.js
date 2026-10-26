jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  order_status_history: { count: jest.fn() },
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../orderSearchSettings", () => ({ getCitySettings: jest.fn().mockResolvedValue({ driverSearchSeconds: 90 }) }));
jest.mock("../orderSearchRules", () => ({ isSystem2Order: jest.fn().mockReturnValue(false), searchDeadline: jest.fn().mockReturnValue(new Date("2026-10-27T10:00:00Z")) }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const rules = require("../orderSearchRules");
const relive = require("../driverCancelRelive");

const ORDER = { id: 5, uid: 7, rid: 11, order_status: 1, o_status: "Processing", delivery_type: 6, city_id: 3 };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([ORDER]);
  prisma.$executeRaw.mockResolvedValue(1);
  prisma.order_status_history.count.mockResolvedValue(0);
  rules.isSystem2Order.mockReturnValue(false);
});

describe("isEnabled", () => {
  it.each([[null, true], [{ setting_value: "" }, true], [{ setting_value: "1" }, true], [{ setting_value: "0" }, false], [{ setting_value: "off" }, false], [{ setting_value: "False" }, false]])(
    "setting %j -> %s", async (row, expected) => {
      prisma.app_settings.findFirst.mockResolvedValue(row);
      expect(await relive.isEnabled()).toBe(expected);
    },
  );
  it("fails closed when the setting cannot be read", async () => {
    prisma.app_settings.findFirst.mockRejectedValue(new Error("db down"));
    expect(await relive.isEnabled()).toBe(false);
  });
});

describe("reopenForRelive", () => {
  it("puts the order back to unassigned Pending and runs the caller's hook in the same transaction", async () => {
    const inTx = jest.fn();
    const out = await relive.reopenForRelive({ orderId: 5, riderId: 11, inTx });
    expect(out).toMatchObject({ relived: true, order: ORDER });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(inTx).toHaveBeenCalledWith(prisma, ORDER);
  });

  it.each([
    ["another driver holds it", { rid: 12 }, "not_assigned_driver"],
    ["the trip is already on its way", { order_status: 3, o_status: "On Route" }, "not_before_pickup"],
    ["not accepted yet", { order_status: 0, o_status: "Pending" }, "not_before_pickup"],
    ["already cancelled", { order_status: 4, o_status: "Cancelled" }, "not_before_pickup"],
  ])("declines when %s", async (_n, patch, reason) => {
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, ...patch }]);
    const inTx = jest.fn();
    expect(await relive.reopenForRelive({ orderId: 5, riderId: 11, inTx })).toEqual({ relived: false, reason });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(inTx).not.toHaveBeenCalled();
  });

  it("declines when the order is missing", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await relive.reopenForRelive({ orderId: 5, riderId: 11 })).toEqual({ relived: false, reason: "not_assigned_driver" });
  });

  it("stops after the maximum number of driver cancels so a booking cannot loop forever", async () => {
    prisma.order_status_history.count.mockResolvedValue(relive.MAX_RELIVES_PER_ORDER);
    expect(await relive.reopenForRelive({ orderId: 5, riderId: 11 })).toEqual({ relived: false, reason: "relive_limit_reached" });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("declines (never throws) when the order changed under the update or the hook fails", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    expect(await relive.reopenForRelive({ orderId: 5, riderId: 11 })).toEqual({ relived: false, reason: "order_changed" });
    prisma.$executeRaw.mockResolvedValue(1);
    expect(await relive.reopenForRelive({ orderId: 5, riderId: 11, inTx: async () => { throw new Error("boom"); } })).toEqual({ relived: false, reason: "error" });
  });
});

describe("afterRelive", () => {
  it("tells the customer the driver cancelled and a new one is being searched, then restarts the search on the same order", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, rid: 0, order_status: 0, o_status: "Pending" });
    await relive.afterRelive({ orderId: 5, riderId: 11, reason: "breakdown" });
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:driver_cancelled", expect.objectContaining({
      order_id: 5, rider_id: 11, refund_amount: 0, refund_status: "order_relive", searching_for_new_driver: true, o_status: "Pending", reason: "breakdown",
    }));
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 5, uid: 7 }), null);
  });

  it("gives a System 2 order a fresh search window", async () => {
    rules.isSystem2Order.mockReturnValue(true);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, rid: 0 });
    await relive.afterRelive({ orderId: 5, riderId: 11 });
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { search_deadline_at: new Date("2026-10-27T10:00:00Z") } });
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(expect.objectContaining({ search_deadline_at: new Date("2026-10-27T10:00:00Z") }), null);
  });

  it("never throws, even if the customer event or the search start fails", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, rid: 0 });
    dispatchManager.emitCustomerEvent.mockImplementation(() => { throw new Error("socket down"); });
    dispatchManager.startDispatch.mockRejectedValue(new Error("dispatch down"));
    await expect(relive.afterRelive({ orderId: 5, riderId: 11 })).resolves.toBeUndefined();
    dispatchManager.emitCustomerEvent.mockReset();
  });

  it("does nothing when the order cannot be read", async () => {
    prisma.pkg_order.findUnique.mockRejectedValue(new Error("db"));
    await relive.afterRelive({ orderId: 5, riderId: 11 });
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });
});
