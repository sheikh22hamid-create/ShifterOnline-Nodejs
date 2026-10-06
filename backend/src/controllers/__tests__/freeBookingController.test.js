jest.mock("../../services/freeBookingService", () => ({ checkEligibility: jest.fn(), getUserStatus: jest.fn() }));
const svc = require("../../services/freeBookingService");
const controller = require("../freeBookingController");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => jest.resetAllMocks());

describe("check", () => {
  const body = { uid: 7, plat: 22.7, plong: 75.8, category: "E-Loader", radius_km: 5, city_id: 3, booking_type: 1 };
  it("400 when required fields are missing", async () => {
    const res = mockRes();
    await controller.check({ body: { uid: 7 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("returns the outcome and its customer message", async () => {
    svc.checkEligibility.mockResolvedValue({ outcome: "no_free_vehicle", cityId: 3, planId: 1, poolRiderId: null });
    const res = mockRes();
    await controller.check({ body }, res);
    expect(svc.checkEligibility).toHaveBeenCalledWith({ uid: 7, plat: 22.7, plong: 75.8, category: "E-Loader", radiusKm: 5, cityId: 3, bookingType: 1 });
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ ResponseCode: "200", Result: "true", outcome: "no_free_vehicle" });
    expect(payload.message).toMatch(/NOT receive any refund/);
  });
  it("500 on an unexpected error", async () => {
    svc.checkEligibility.mockRejectedValue(new Error("db"));
    const res = mockRes();
    await controller.check({ body }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("status", () => {
  it("400 without uid", async () => {
    const res = mockRes();
    await controller.status({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("returns the state", async () => {
    svc.getUserStatus.mockResolvedValue({ state: "locked", message: "m" });
    const res = mockRes();
    await controller.status({ body: { uid: 7 } }, res);
    expect(res.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: "true", state: "locked", message: "m" });
  });
});
