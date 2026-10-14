jest.mock("../../config/db", () => ({
  admin: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_city: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  driver_training_progress: { deleteMany: jest.fn() },
  monthly_driver_ledger: { create: jest.fn() },
  tbl_pending_reward_plan: { findUnique: jest.fn() },
  $executeRawUnsafe: jest.fn().mockResolvedValue(0),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../utils/assignDefaultDeliveryTypes", () => ({ assignDefaultDeliveryTypes: jest.fn() }));
jest.mock("../../services/rewardPlanService", () => ({ assignPlanNow: jest.fn().mockResolvedValue({ plan: { plan_name: "P" }, subscription: { id: 1 } }) }));
jest.mock("../../services/dutyTrackingService", () => ({ getDriverDutyStatus: jest.fn().mockResolvedValue({}) }));
jest.mock("../../services/pushNotifier", () => ({}));
jest.mock("../../services/dispatchManager", () => ({}));
jest.mock("../../services/bookingGuaranteeService", () => ({}));

const prisma = require("../../config/db");
const scopeFilter = require("../../middleware/scopeFilter");
const auth = require("../authController");
const trial = require("../adminTrialDriverController");
const training = require("../adminTrainingController");
const monthly = require("../monthlyDriverController");
const reward = require("../rewardPlanController");

const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const asAdmin = (extra = {}) => ({ user: { id: 1, role: "admin", city_id: 3 }, query: {}, params: {}, body: {}, ...extra });
const asSuper = (extra = {}) => ({ user: { id: 1, role: "superadmin", city_id: null }, query: {}, params: {}, body: {}, ...extra });
const otherCityRider = () => prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, city_id: 4 }]);
beforeEach(() => jest.clearAllMocks());

describe("scopeFilter", () => {
  it("binds a city admin to their city and fails closed without one", () => {
    const next = jest.fn();
    const ok = { user: { role: "admin", city_id: 3 }, query: { city_id: "9" } };
    scopeFilter(ok, res(), next);
    expect(ok.scopedCityId).toBe(3);
    const bad = res();
    scopeFilter({ user: { role: "executive", city_id: null }, query: {} }, bad, next);
    expect(bad.status).toHaveBeenCalledWith(403);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it("lets a superadmin narrow by city but ignores a junk city_id", () => {
    const a = { user: { role: "superadmin" }, query: { city_id: "5" } };
    const b = { user: { role: "superadmin" }, query: { city_id: "abc" } };
    scopeFilter(a, res(), jest.fn());
    scopeFilter(b, res(), jest.fn());
    expect(a.scopedCityId).toBe(5);
    expect(b.scopedCityId).toBeNull();
  });
});

describe("admin login / me", () => {
  it("blocks a deactivated admin at login (status is a Boolean)", async () => {
    prisma.admin.findFirst.mockResolvedValue({ id: 1, username: "a", status: false, password: "x" });
    const r = res();
    await auth.login({ body: { username: "a", password: "p" } }, r);
    expect(r.status).toHaveBeenCalledWith(403);
  });
  it("me() kicks out a deactivated admin and one whose role or city changed since the token", async () => {
    prisma.admin.findUnique.mockResolvedValue({ id: 1, status: false, role: "admin", city_id: 3 });
    const a = res();
    await auth.me({ user: { id: 1, role: "admin", city_id: 3 } }, a);
    expect(a.status).toHaveBeenCalledWith(403);

    prisma.admin.findUnique.mockResolvedValue({ id: 1, status: true, role: "admin", city_id: 3 });
    const b = res();
    await auth.me({ user: { id: 1, role: "executive", city_id: 3 } }, b);
    expect(b.status).toHaveBeenCalledWith(401);
    const c = res();
    await auth.me({ user: { id: 1, role: "admin", city_id: 8 } }, c);
    expect(c.status).toHaveBeenCalledWith(401);
  });
  it("me() still works when the token matches the account", async () => {
    prisma.admin.findUnique.mockResolvedValue({ id: 1, username: "a", status: true, role: "admin", city_id: 3 });
    prisma.tbl_city.findUnique.mockResolvedValue({ title: "Indore" });
    const r = res();
    await auth.me({ user: { id: 1, role: "admin", city_id: 3 } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
  });
});

describe("city admin cannot act on another city's driver", () => {
  it("trial drivers: block is 403 for another city, allowed for own city and for a superadmin", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 4 });
    const denied = res();
    await trial.block(asAdmin({ params: { id: "9" } }), denied);
    expect(denied.status).toHaveBeenCalledWith(403);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();

    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3 });
    await trial.block(asAdmin({ params: { id: "9" } }), res());
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);

    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 4 });
    await trial.upgrade(asSuper({ params: { id: "9" } }), res());
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(2);
  });
  it("trial drivers: the list is limited to the caller's city; create cannot take over another city's driver", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    await trial.list(asAdmin(), res());
    expect(prisma.tbl_rider.findMany.mock.calls[0][0].where).toMatchObject({ city_id: 3 });

    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 9, city_id: 4, trial_status: "none", full_name: "X" });
    const r = res();
    await trial.create(asAdmin({ body: { full_name: "X", fmobile: "9", vehicle: "Bike", trial_orders_allowed: 3 } }), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
  it("trial drivers: a new driver is always created in the city admin's own city", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    prisma.tbl_rider.create.mockResolvedValue({ id: 20, fmobile: "9", full_name: "N" });
    await trial.create(asAdmin({ body: { full_name: "N", fmobile: "9", vehicle: "Bike", city_id: 99, trial_orders_allowed: 3 } }), res());
    expect(prisma.tbl_rider.create.mock.calls[0][0].data.city_id).toBe(3);
  });
  it("training reset and monthly ledger adjustment refuse another city's driver", async () => {
    otherCityRider();
    const a = res();
    await training.resetProgress(asAdmin({ params: { riderId: "9" } }), a);
    expect(a.status).toHaveBeenCalledWith(403);
    expect(prisma.driver_training_progress.deleteMany).not.toHaveBeenCalled();

    const b = res();
    await monthly.addLedgerAdjustment(asAdmin({ params: { riderId: "9" }, body: { entry_type: "BONUS", amount: 100, balance_effect: "credit" } }), b);
    expect(b.status).toHaveBeenCalledWith(403);
    expect(prisma.monthly_driver_ledger.create).not.toHaveBeenCalled();
  });
  it("the driver-app route (no req.user) is not blocked by the admin city check", async () => {
    const r = res();
    await monthly.getDutyStatus({ params: { riderId: "9" }, query: {} }, r);
    expect(prisma.tbl_rider.findMany).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith({ success: true, data: {} });
  });
  it("reward plans: cannot assign a plan to another city's customer", async () => {
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 5, city_id: 4 }]);
    const r = res();
    await reward.assignNow(asAdmin({ body: { user_id: 5, user_type: "USER", plan_id: 2 } }), r);
    expect(r.status).toHaveBeenCalledWith(403);
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 5, city_id: 3 }]);
    const ok = res();
    await reward.assignNow(asAdmin({ body: { user_id: 5, user_type: "USER", plan_id: 2 } }), ok);
    expect(ok.status).toHaveBeenCalledWith(200);
  });
});
