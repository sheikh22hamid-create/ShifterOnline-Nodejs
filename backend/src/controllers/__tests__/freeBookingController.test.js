jest.mock("../../services/freeBookingService", () => ({ checkEligibility: jest.fn(), getUserStatus: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
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

describe("check input validation", () => {
  const body = { uid: 7, plat: 22.7, plong: 75.8, category: "E-Loader" };
  it.each([["abc"], [0], [-3], ["-1"], [Infinity]])("400 for radius_km %p", async (radius_km) => {
    const res = mockRes();
    await controller.check({ body: { ...body, radius_km } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ ResponseCode: "400", Result: "false", ResponseMsg: expect.any(String) });
    expect(svc.checkEligibility).not.toHaveBeenCalled();
  });
  it.each([[4], [0], ["abc"], [5], ["2.5"]])("400 for booking_type %p", async (booking_type) => {
    const res = mockRes();
    await controller.check({ body: { ...body, booking_type } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(svc.checkEligibility).not.toHaveBeenCalled();
  });
  it("absent radius_km and booking_type default to 4 and 1", async () => {
    svc.checkEligibility.mockResolvedValue({ outcome: "eligible" });
    const res = mockRes();
    await controller.check({ body }, res);
    expect(svc.checkEligibility).toHaveBeenCalledWith(expect.objectContaining({ radiusKm: 4, bookingType: 1 }));
    expect(res.status).not.toHaveBeenCalled();
  });
  it.each([[2], ["3"]])("accepts booking_type %p", async (booking_type) => {
    svc.checkEligibility.mockResolvedValue({ outcome: "offer_off" });
    const res = mockRes();
    await controller.check({ body: { ...body, booking_type } }, res);
    expect(svc.checkEligibility).toHaveBeenCalledWith(expect.objectContaining({ bookingType: Number(booking_type) }));
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
  it("500 when the service rejects", async () => {
    svc.getUserStatus.mockRejectedValue(new Error("db"));
    const res = mockRes();
    await controller.status({ body: { uid: 7 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  });
});
