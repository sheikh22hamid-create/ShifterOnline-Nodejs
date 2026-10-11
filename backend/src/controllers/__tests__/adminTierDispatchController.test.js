jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../config/db", () => ({ $queryRaw: jest.fn() }));
jest.mock("../../services/tieredDispatchSettings", () => ({ getTierSettings: jest.fn(), saveTierSettings: jest.fn() }));
jest.mock("../../services/tierPenaltyService", () => ({ waive: jest.fn(), resetCounter: jest.fn() }));
jest.mock("../../services/cancelRequestService", () => ({ listRequests: jest.fn(), approve: jest.fn(), reject: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../../services/tieredDispatchSettings");
const penalty = require("../../services/tierPenaltyService");
const cancels = require("../../services/cancelRequestService");
const ctrl = require("../adminTierDispatchController");

const mkRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const mkReq = (user, extra = {}) => ({ user, query: {}, body: {}, params: {}, ...extra });
const superadmin = { id: 1, role: "superadmin", city_id: null };
const cityAdmin = { id: 2, role: "admin", city_id: 3 };
const cityless = { id: 3, role: "admin", city_id: null };

beforeEach(() => jest.clearAllMocks());

describe("settings", () => {
  it("only a superadmin may change the global dispatch settings", async () => {
    const res = mkRes();
    await ctrl.saveSettings(mkReq(cityAdmin, { body: { tiered_dispatch_enabled: true } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(settings.saveTierSettings).not.toHaveBeenCalled();
  });

  it("a superadmin saves and gets the new settings back", async () => {
    settings.saveTierSettings.mockResolvedValue({ tieredEnabled: true });
    const res = mkRes();
    await ctrl.saveSettings(mkReq(superadmin, { body: { tiered_dispatch_enabled: true, penalty_enabled: false, ladder: "5,10", cancel_penalty_pct: 50 } }), res);
    expect(settings.saveTierSettings).toHaveBeenCalledWith({ tieredEnabled: true, penaltyEnabled: false, ladder: "5,10", cancelPenaltyPct: 50 });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: { tieredEnabled: true } }));
  });

  it("a validation error from the service is a 400", async () => {
    settings.saveTierSettings.mockRejectedValue(Object.assign(new Error("bad ladder"), { statusCode: 400 }));
    const res = mkRes();
    await ctrl.saveSettings(mkReq(superadmin, { body: { ladder: "500" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("city scoping", () => {
  it("a city-less admin is refused on every scoped list", async () => {
    for (const fn of [ctrl.listPenalties, ctrl.listCancelRequests]) {
      const res = mkRes();
      await fn(mkReq(cityless), res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });

  it("a city admin only gets their own city's cancel requests", async () => {
    cancels.listRequests.mockResolvedValue([]);
    await ctrl.listCancelRequests(mkReq(cityAdmin, { query: { city_id: "9" } }), mkRes());
    expect(cancels.listRequests).toHaveBeenCalledWith({ status: "pending", cityId: 3 });
  });

  it("a superadmin sees all cities unless a city_id filter is given", async () => {
    cancels.listRequests.mockResolvedValue([]);
    await ctrl.listCancelRequests(mkReq(superadmin), mkRes());
    expect(cancels.listRequests).toHaveBeenCalledWith({ status: "pending", cityId: null });
    await ctrl.listCancelRequests(mkReq(superadmin, { query: { city_id: "2" } }), mkRes());
    expect(cancels.listRequests).toHaveBeenLastCalledWith({ status: "pending", cityId: 2 });
  });

  it("penalties are listed through a city-filtered query for a city admin", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1 }]);
    const res = mkRes();
    await ctrl.listPenalties(mkReq(cityAdmin, { query: { tier: "free" } }), res);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 1 }] });
  });
});

describe("actions", () => {
  // The ownership check asks which city the row belongs to; for these tests it is the admin's own city.
  beforeEach(() => prisma.$queryRaw.mockResolvedValue([{ city_id: 3 }]));

  it("waive passes the admin id and rejects a non-numeric id with 400", async () => {
    penalty.waive.mockResolvedValue({ waived: true });
    const res = mkRes();
    await ctrl.waivePenalty(mkReq(cityAdmin, { params: { id: "70" } }), res);
    expect(penalty.waive).toHaveBeenCalledWith({ penaltyId: 70, adminId: 2 });
    const bad = mkRes();
    await ctrl.waivePenalty(mkReq(cityAdmin, { params: { id: "abc" } }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);
  });

  it("reset counter validates the tier", async () => {
    const res = mkRes();
    await ctrl.resetCounter(mkReq(cityAdmin, { body: { rider_id: 9, tier: "normal" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    penalty.resetCounter.mockResolvedValue();
    const ok = mkRes();
    await ctrl.resetCounter(mkReq(cityAdmin, { body: { rider_id: 9, tier: "free" } }), ok);
    expect(penalty.resetCounter).toHaveBeenCalledWith({ riderId: 9, tier: "free", adminId: 2 });
  });

  it("approve returns the service result; a 409 from the service is forwarded", async () => {
    cancels.approve.mockResolvedValue({ ok: true, nextStage: "daily" });
    const res = mkRes();
    await ctrl.approveCancel(mkReq(cityAdmin, { params: { id: "12" } }), res);
    expect(cancels.approve).toHaveBeenCalledWith({ requestId: 12, adminId: 2 });
    cancels.approve.mockRejectedValue(Object.assign(new Error("already decided"), { statusCode: 409 }));
    const dup = mkRes();
    await ctrl.approveCancel(mkReq(cityAdmin, { params: { id: "12" } }), dup);
    expect(dup.status).toHaveBeenCalledWith(409);
  });
});

describe("cross-city actions", () => {
  it("a city admin cannot approve a cancel request that belongs to another city", async () => {
    prisma.$queryRaw.mockResolvedValue([{ city_id: 9 }]);
    const res = mkRes();
    await ctrl.approveCancel(mkReq(cityAdmin, { params: { id: "12" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(cancels.approve).not.toHaveBeenCalled();
  });

  it("a city admin cannot waive a penalty of a rider in another city", async () => {
    prisma.$queryRaw.mockResolvedValue([{ city_id: 9 }]);
    const res = mkRes();
    await ctrl.waivePenalty(mkReq(cityAdmin, { params: { id: "70" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(penalty.waive).not.toHaveBeenCalled();
  });
});
