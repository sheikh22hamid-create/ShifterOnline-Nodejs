jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  tbl_user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_premium_plan: { findUnique: jest.fn() },
  free_booking_setting: { findUnique: jest.fn() },
  free_booking_pool: { findMany: jest.fn() },
  free_booking_order: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../pricingEngine", () => ({ getActiveCustomerPlan: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue() }));
jest.mock("../customerInbox", () => ({ saveCustomerNotification: jest.fn().mockResolvedValue() }));

const prisma = require("../../config/db");
const pricingEngine = require("../pricingEngine");
const logger = require("../../utils/logger");
const svc = require("../freeBookingService");

const hour = 3600 * 1000;
const openSetting = () => ({ enabled: true, offer_start: new Date(Date.now() - hour), offer_end: new Date(Date.now() + hour) });
const input = { uid: 7, plat: 22.7, plong: 75.8, category: "E-Loader", radiusKm: 5, cityId: 3, bookingType: 1 };

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.resetAllMocks();
  prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false });
  pricingEngine.getActiveCustomerPlan.mockResolvedValue({ planId: 11 });
  prisma.free_booking_setting.findUnique.mockResolvedValue(openSetting());
  prisma.$queryRaw.mockResolvedValue([]);
});

describe("checkEligibility", () => {
  it("not_premium when there is no active customer plan", async () => {
    pricingEngine.getActiveCustomerPlan.mockResolvedValue(null);
    expect((await svc.checkEligibility(input)).outcome).toBe("not_premium");
  });
  it("offer_off when the city has no setting row", async () => {
    prisma.free_booking_setting.findUnique.mockResolvedValue(null);
    expect((await svc.checkEligibility(input)).outcome).toBe("offer_off");
  });
  it("offer_off when now is outside the admin timeline", async () => {
    prisma.free_booking_setting.findUnique.mockResolvedValue({ ...openSetting(), offer_end: new Date(Date.now() - 1000) });
    expect((await svc.checkEligibility(input)).outcome).toBe("offer_off");
  });
  it("offer_off for scheduled and next-day bookings", async () => {
    expect((await svc.checkEligibility({ ...input, bookingType: 2 })).outcome).toBe("offer_off");
    expect((await svc.checkEligibility({ ...input, bookingType: 3 })).outcome).toBe("offer_off");
  });
  it("locked when the user is locked", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: true });
    expect((await svc.checkEligibility(input)).outcome).toBe("locked");
  });
  it("open_booking when an earlier free booking is still open (the retry credit leaves it open)", async () => {
    const credit = jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: false, action: "wait" });
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, order_id: 41, o_status: "Completed" }]).mockResolvedValueOnce([{ id: 1, order_id: 41, o_status: "Completed" }]);
    expect((await svc.checkEligibility(input)).outcome).toBe("open_booking");
    expect(credit).toHaveBeenCalledTimes(1);
    expect(credit).toHaveBeenCalledWith(41);
  });
  it("self-heals: a stuck open row is credited on the next check and the user is then locked", async () => {
    const credit = jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: true, action: "credit" });
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, order_id: 41, o_status: "Completed" }]).mockResolvedValueOnce([]);
    prisma.tbl_user.findUnique
      .mockResolvedValueOnce({ city_id: 3, free_booking_locked: false })
      .mockResolvedValueOnce({ free_booking_locked: true });
    const out = await svc.checkEligibility(input);
    expect(credit).toHaveBeenCalledWith(41);
    expect(out.outcome).toBe("locked");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it("self-heals: a stuck row that is voided frees the user to proceed to the pool check", async () => {
    jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: false, action: "void" });
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, order_id: 41, o_status: "Completed" }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ rider_id: 9, distance_km: 1 }]);
    prisma.tbl_user.findUnique
      .mockResolvedValueOnce({ city_id: 3, free_booking_locked: false })
      .mockResolvedValueOnce({ free_booking_locked: false });
    expect((await svc.checkEligibility(input)).outcome).toBe("eligible");
  });
  it("does not retry the credit when there is no open row", async () => {
    const credit = jest.spyOn(svc, "tryCredit");
    await svc.checkEligibility(input);
    expect(credit).not.toHaveBeenCalled();
  });
  it("the open-booking query ignores cancelled orders", async () => {
    await svc.checkEligibility(input);
    const sql = prisma.$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toContain("o.o_status <> 'Cancelled'");
  });
  it("no_free_vehicle when every pool driver is offline, stale or busy (query returns nothing)", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const out = await svc.checkEligibility(input);
    expect(out.outcome).toBe("no_free_vehicle");
    expect(out.poolRiderId).toBeNull();
  });
  it("eligible with the nearest pool driver", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ rider_id: 9, distance_km: 1.2 }]);
    const out = await svc.checkEligibility(input);
    expect(out).toMatchObject({ outcome: "eligible", poolRiderId: 9, planId: 11, cityId: 3 });
  });
  it("falls back to the user's own city when the request has none", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ rider_id: 9, distance_km: 1 }]);
    const out = await svc.checkEligibility({ ...input, cityId: undefined });
    expect(out.cityId).toBe(3);
    expect(prisma.free_booking_setting.findUnique).toHaveBeenCalledWith({ where: { city_id: 3 } });
  });
});

describe("createForOrder", () => {
  it("writes a CONFIRMED row with the plan snapshot", async () => {
    prisma.tbl_premium_plan.findUnique.mockResolvedValue({ price: "199.00" });
    prisma.free_booking_order.create.mockResolvedValue({ id: 1 });
    await svc.createForOrder({ order: { id: 50, uid: 7 }, check: { cityId: 3, planId: 11 }, radiusKm: 4.6 });
    expect(prisma.free_booking_order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        order_id: 50, user_id: 7, city_id: 3, status: "FREE_BOOKING_CONFIRMED",
        search_radius_km: 5, premium_plan_id: 11, premium_plan_amount: "199.00",
      }),
    });
  });
});

describe("createForOrder without a plan", () => {
  it("skips the premium_plan lookup and stores a null amount when planId is null", async () => {
    prisma.free_booking_order.create.mockResolvedValue({ id: 1 });
    await svc.createForOrder({ order: { id: 50, uid: 7 }, check: { cityId: 3, planId: null }, radiusKm: 4 });
    expect(prisma.tbl_premium_plan.findUnique).not.toHaveBeenCalled();
    expect(prisma.free_booking_order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ premium_plan_id: null, premium_plan_amount: null }),
    });
  });
});

describe("getDispatchPoolFilter", () => {
  it("returns null for a normal order", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(null);
    expect(await svc.getDispatchPoolFilter({ id: 50 })).toBeNull();
  });
  it("returns null once the row is no longer CONFIRMED", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue({ status: "FREE_BOOKING_NOT_ELIGIBLE", city_id: 3 });
    expect(await svc.getDispatchPoolFilter({ id: 50 })).toBeNull();
  });
  it("returns the pool rider ids for a CONFIRMED order", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue({ status: "FREE_BOOKING_CONFIRMED", city_id: 3 });
    prisma.free_booking_pool.findMany.mockResolvedValue([{ rider_id: 9 }, { rider_id: 9 }, { rider_id: 12 }]);
    expect(await svc.getDispatchPoolFilter({ id: 50 })).toEqual([9, 12]);
  });
  it("never throws: a DB error means no filter", async () => {
    prisma.free_booking_order.findUnique.mockRejectedValue(new Error("boom"));
    expect(await svc.getDispatchPoolFilter({ id: 50 })).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("self-heal retry only for completed orders", () => {
  const openRow = (o_status) => [{ id: 1, order_id: 41, o_status }];
  it("does not call tryCredit while the order is still in progress (CONFIRMED row, Processing order)", async () => {
    const credit = jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: false, action: "wait" });
    prisma.$queryRaw.mockResolvedValueOnce(openRow("Processing"));
    expect((await svc.checkEligibility(input)).outcome).toBe("open_booking");
    expect(credit).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it("getUserStatus: in-progress order stays open_booking without tryCredit", async () => {
    const credit = jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: false, action: "wait" });
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false });
    prisma.$queryRaw.mockResolvedValueOnce(openRow("Processing"));
    expect((await svc.getUserStatus(7)).state).toBe("open_booking");
    expect(credit).not.toHaveBeenCalled();
  });
  it("calls tryCredit exactly once for a Completed order with a REWARD_PENDING row", async () => {
    const credit = jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: false, action: "wait" });
    prisma.$queryRaw.mockResolvedValueOnce(openRow("Completed")).mockResolvedValueOnce(openRow("Completed"));
    expect((await svc.checkEligibility(input)).outcome).toBe("open_booking");
    expect(credit).toHaveBeenCalledTimes(1);
    expect(credit).toHaveBeenCalledWith(41);
  });
});

describe("getUserStatus", () => {
  it("offer_off when the city has no setting", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false });
    prisma.free_booking_setting.findUnique.mockResolvedValue(null);
    const out = await svc.getUserStatus(7);
    expect(out.state).toBe("offer_off");
    expect(out.message).toMatch(/not available/i);
  });
  it("not_premium without an active plan", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false });
    pricingEngine.getActiveCustomerPlan.mockResolvedValue(null);
    const out = await svc.getUserStatus(7);
    expect(out.state).toBe("not_premium");
    expect(out.message).toMatch(/Premium/);
  });
  it("open_booking returns the settling message", async () => {
    jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: false, action: "wait" });
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false });
    prisma.$queryRaw.mockResolvedValue([{ id: 1, order_id: 41, o_status: "Completed" }]);
    const out = await svc.getUserStatus(7);
    expect(out.state).toBe("open_booking");
    expect(out.message).toMatch(/still being settled/i);
  });
  it("open_booking after one retry credit leaves the row open", async () => {
    const credit = jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: false, action: "wait" });
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false });
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, order_id: 41, o_status: "Completed" }]).mockResolvedValueOnce([{ id: 1, order_id: 41, o_status: "Completed" }]);
    expect((await svc.getUserStatus(7)).state).toBe("open_booking");
    expect(credit).toHaveBeenCalledWith(41);
  });
  it("self-heals a stuck row: after the retry credit the state is locked, not open_booking", async () => {
    jest.spyOn(svc, "tryCredit").mockResolvedValue({ credited: true, action: "credit" });
    prisma.tbl_user.findUnique
      .mockResolvedValueOnce({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false })
      .mockResolvedValueOnce({ free_booking_locked: true });
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1, order_id: 41, o_status: "Completed" }]).mockResolvedValueOnce([]);
    expect((await svc.getUserStatus(7)).state).toBe("locked");
  });
  it("available for a premium, unlocked user in an open city", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false });
    expect((await svc.getUserStatus(7)).state).toBe("available");
  });
  it("unlocked is shown once and the flag is cleared", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: true });
    expect((await svc.getUserStatus(7)).state).toBe("unlocked");
    expect(prisma.tbl_user.updateMany).toHaveBeenCalledWith({ where: { id: 7, free_booking_just_unlocked: true }, data: { free_booking_just_unlocked: false } });
  });
  it("locked", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: true, free_booking_just_unlocked: false });
    const out = await svc.getUserStatus(7);
    expect(out.state).toBe("locked");
    expect(out.message).toMatch(/referral/i);
  });
  it("not_premium is only reported while the offer is open in the city", async () => {
    pricingEngine.getActiveCustomerPlan.mockResolvedValue(null);
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false });
    expect((await svc.getUserStatus(7)).state).toBe("not_premium");
    prisma.free_booking_setting.findUnique.mockResolvedValue({ enabled: false });
    expect((await svc.getUserStatus(7)).state).toBe("offer_off");
  });
  it("locked message names the city's required referral count", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: true, free_booking_just_unlocked: false });
    prisma.free_booking_setting.findUnique.mockResolvedValue({ ...openSetting(), referrals_required: 3 });
    expect((await svc.getUserStatus(7)).message).toMatch(/Complete 3 successful referrals/);
  });
  it("checkEligibility returns the locked message with the required count", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: true });
    prisma.free_booking_setting.findUnique.mockResolvedValue({ ...openSetting(), referrals_required: 2 });
    const out = await svc.checkEligibility(input);
    expect(out.outcome).toBe("locked");
    expect(out.message).toMatch(/Complete 2 successful referrals/);
  });
});
