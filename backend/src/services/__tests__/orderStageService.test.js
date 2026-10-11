jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  order_dispatch_stage: { findUnique: jest.fn(), upsert: jest.fn() },
  free_booking_order: { findUnique: jest.fn() },
  tbl_order_requests: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../tieredDispatchSettings", () => ({ isTieredEnabled: jest.fn() }));
jest.mock("../freeBookingService", () => ({ poolRiderIds: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../tieredDispatchSettings");
const freeBooking = require("../freeBookingService");
const stage = require("../orderStageService");

beforeEach(() => jest.clearAllMocks());

describe("decideStartStage", () => {
  it("returns null when tiered dispatch is off", async () => {
    settings.isTieredEnabled.mockResolvedValue(false);
    expect(await stage.decideStartStage({ id: 5 })).toBeNull();
  });

  it("starts a confirmed free booking at the free stage", async () => {
    settings.isTieredEnabled.mockResolvedValue(true);
    prisma.free_booking_order.findUnique.mockResolvedValue({ status: "FREE_BOOKING_CONFIRMED" });
    expect(await stage.decideStartStage({ id: 5 })).toBe("free");
  });

  it("starts every other order at the daily stage", async () => {
    settings.isTieredEnabled.mockResolvedValue(true);
    prisma.free_booking_order.findUnique.mockResolvedValue(null);
    expect(await stage.decideStartStage({ id: 5 })).toBe("daily");
  });

  it("a free booking row that is no longer CONFIRMED starts at daily", async () => {
    settings.isTieredEnabled.mockResolvedValue(true);
    prisma.free_booking_order.findUnique.mockResolvedValue({ status: "FREE_BOOKING_NOT_ELIGIBLE" });
    expect(await stage.decideStartStage({ id: 5 })).toBe("daily");
  });
});

describe("riderIdsForStage", () => {
  it("free: the city's pool riders, using the free-booking row's city first", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue({ city_id: 3 });
    freeBooking.poolRiderIds.mockResolvedValue([11, 12]);
    expect(await stage.riderIdsForStage("free", { id: 5, city_id: 9 })).toEqual([11, 12]);
    expect(freeBooking.poolRiderIds).toHaveBeenCalledWith(3);
  });

  it("free: falls back to the order's city, and to an empty list when there is no city", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue({ city_id: null });
    freeBooking.poolRiderIds.mockResolvedValue([7]);
    expect(await stage.riderIdsForStage("free", { id: 5, city_id: 9 })).toEqual([7]);
    expect(freeBooking.poolRiderIds).toHaveBeenCalledWith(9);
    prisma.free_booking_order.findUnique.mockResolvedValue(null);
    expect(await stage.riderIdsForStage("free", { id: 5, city_id: null })).toEqual([]);
  });

  it("daily: riders with an in-progress duty log that has punched in and not out", async () => {
    prisma.$queryRaw.mockResolvedValue([{ rider_id: 21 }, { rider_id: 22 }]);
    expect(await stage.riderIdsForStage("daily", { id: 5 })).toEqual([21, 22]);
  });

  it("normal: null means no restriction", async () => {
    expect(await stage.riderIdsForStage("normal", { id: 5 })).toBeNull();
  });
});

describe("stage persistence", () => {
  it("setStage upserts and swallows DB errors", async () => {
    prisma.order_dispatch_stage.upsert.mockRejectedValue(new Error("boom"));
    await expect(stage.setStage(5, "daily")).resolves.toBeUndefined();
  });

  it("getStage returns the stored stage or null", async () => {
    prisma.order_dispatch_stage.findUnique.mockResolvedValue({ stage: "free" });
    expect(await stage.getStage(5)).toBe("free");
    prisma.order_dispatch_stage.findUnique.mockResolvedValue(null);
    expect(await stage.getStage(5)).toBeNull();
    prisma.order_dispatch_stage.findUnique.mockRejectedValue(new Error("boom"));
    expect(await stage.getStage(5)).toBeNull();
  });
});

describe("offeredRiderIds", () => {
  it("returns the distinct riders this order was ever offered to", async () => {
    prisma.tbl_order_requests.findMany.mockResolvedValue([{ rider_id: 3 }, { rider_id: 4 }]);
    expect(await stage.offeredRiderIds(5)).toEqual([3, 4]);
  });
});
