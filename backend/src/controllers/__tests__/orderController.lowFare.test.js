jest.mock("../../config/db", () => ({
  pkg_order: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  tbl_package: { findMany: jest.fn(), findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  pkg_order_stops: { createMany: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  $queryRaw: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../services/lowFareSettings", () => ({
  isEnabled: jest.fn(),
  getConfig: jest.fn().mockResolvedValue({ discountPercent: 20, maxDaysAhead: 7, maxWindowHours: 12 }),
}));

const prisma = require("../../config/db");
const dispatchManager = require("../../services/dispatchManager");
const lowFareSettings = require("../../services/lowFareSettings");
const pricingEngine = require("../../services/pricingEngine");
const { createOrderCore } = require("../orderController");

const tomorrowIst = new Date(Date.now() + 330 * 60000 + 86400000).toISOString().slice(0, 10);
const WINDOW = { date: tomorrowIst, from: "14:00", until: "16:00" };
const BASE = {
  uid: 1, category: "Tata Ace", deliveryTypeIds: [6], bookingType: 3,
  plat: "22.70", plong: "75.80", dlat: "22.75", dlong: "75.90", distance: 5, totalDcharge: 1, dCharge: 1,
};
const round2 = (n) => Math.round(n * 100) / 100;
const created = () => prisma.pkg_order.create.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  lowFareSettings.isEnabled.mockResolvedValue(true);
  lowFareSettings.getConfig.mockResolvedValue({ discountPercent: 20, maxDaysAhead: 7, maxWindowHours: 12 });
  jest.spyOn(pricingEngine, "getActiveCustomerPlan").mockResolvedValue({ subscriptionId: 5, noAdvancePayment: false });
  prisma.app_settings.findFirst.mockResolvedValue(null);
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, sort_order: 1, min_charge: 500, per_km_charge: 40, title: "Model 1", driver_per_percent: "90" }]);
  prisma.pkg_order.create.mockImplementation(({ data }) => Promise.resolve({ id: 555, ...data }));
});
afterEach(() => jest.restoreAllMocks());

describe("createOrderCore: Low Fare Booking (switch ON, booking_type 3)", () => {
  it("stores the Model-1 fare, the discount and the window, charges the discounted fare and never uses the client's price", async () => {
    const out = await createOrderCore({ ...BASE, lowFareWindow: WINDOW });
    expect(out.ok).toBe(true);
    const d = created();
    const model1 = Number(d.next_day_model1_fare);
    expect(model1).toBeGreaterThan(1); // computed on the server, not the client's 1
    expect(Number(d.next_day_discount_percent)).toBe(20);
    expect(d.total_dcharge).toBe(round2(model1 - (model1 * 20) / 100));
    expect(d.d_charge).toBe(d.total_dcharge);
    expect(d).toMatchObject({ booking_type: 3, next_day_stage: "low_fare", schedule_date_time: tomorrowIst });
    expect(d.next_day_live_at).toEqual(new Date(`${tomorrowIst}T14:00:00+05:30`));
    expect(d.next_day_live_until).toEqual(new Date(`${tomorrowIst}T16:00:00+05:30`));
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });

  it("derives the commission from the discounted fare, not the Model-1 fare", async () => {
    await createOrderCore({ ...BASE, lowFareWindow: WINDOW });
    const d = created();
    expect(d.commission).toBe(pricingEngine.calculateCommissionPercent(d.total_dcharge, pricingEngine.calculateDriverEarning({ driver_per_percent: "90" }, d.total_dcharge)));
  });

  it("keeps the stored fare when the admin later changes the discount (it is computed once, at booking)", async () => {
    await createOrderCore({ ...BASE, lowFareWindow: WINDOW });
    const first = created();
    prisma.pkg_order.create.mockClear();
    lowFareSettings.getConfig.mockResolvedValue({ discountPercent: 50, maxDaysAhead: 7, maxWindowHours: 12 });
    await createOrderCore({ ...BASE, lowFareWindow: WINDOW });
    expect(Number(created().next_day_discount_percent)).toBe(50);
    expect(Number(first.next_day_discount_percent)).toBe(20);
  });

  it("refuses a non-Premium customer even with a valid window", async () => {
    pricingEngine.getActiveCustomerPlan.mockResolvedValue(null);
    const out = await createOrderCore({ ...BASE, lowFareWindow: WINDOW });
    expect(out).toMatchObject({ ok: false, code: "PREMIUM_PLAN_REQUIRED" });
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...WINDOW, until: "13:00" }, "End time must be after the start time"],
    [{ ...WINDOW, date: "2020-01-01" }, "Choose a date from tomorrow onwards"],
    [undefined, "Choose a valid date"],
  ])("rejects window %j with a plain message and creates nothing", async (lowFareWindow, msg) => {
    const out = await createOrderCore({ ...BASE, lowFareWindow });
    expect(out).toEqual({ ok: false, code: "VALIDATION", msg });
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });
});

describe("createOrderCore: everything else is unchanged", () => {
  it("switch OFF: a next-day order is still the old 'arranging' order with the rate-card fare and no Low Fare fields", async () => {
    lowFareSettings.isEnabled.mockResolvedValue(false);
    await createOrderCore({ ...BASE, lowFareWindow: WINDOW });
    const d = created();
    expect(d.next_day_stage).toBe("arranging");
    expect(d.next_day_model1_fare).toBeUndefined();
    expect(d.next_day_live_until).toBeUndefined();
  });

  it("an ordinary booking (type 1) never gets Low Fare fields even with the switch ON", async () => {
    await createOrderCore({ ...BASE, bookingType: 1, lowFareWindow: WINDOW });
    const d = created();
    expect(d.next_day_stage).toBeUndefined();
    expect(d.next_day_model1_fare).toBeUndefined();
    expect(dispatchManager.startDispatch).toHaveBeenCalled();
  });
});
