jest.mock("../../services/bookingGuaranteeService", () => ({ quote: jest.fn() }));
jest.mock("../../services/pickupCityService", () => ({ resolvePickupCityId: jest.fn() }));
jest.mock("../../config/db", () => ({ tbl_user: { findUnique: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const svc = require("../../services/bookingGuaranteeService");
const { resolvePickupCityId } = require("../../services/pickupCityService");
const { quote } = require("../bookingGuaranteeController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => {
  jest.clearAllMocks();
  resolvePickupCityId.mockResolvedValue(null);
  prisma.tbl_user.findUnique.mockResolvedValue(null);
});

describe("bookingGuaranteeController.quote", () => {
  it("returns the amount for the selected packages", async () => {
    svc.quote.mockResolvedValue({ packageId: 20, amount: 100 });
    const r = res();
    await quote({ body: { package_ids: [10, 20] } }, r);
    expect(svc.quote).toHaveBeenCalledWith([10, 20], { cityId: null, uid: null });
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: "true", amount: 100, package_id: 20 });
  });
  it("uses the pickup's city when pickup coordinates are sent", async () => {
    svc.quote.mockResolvedValue({ packageId: 20, amount: 100 });
    resolvePickupCityId.mockResolvedValue(5);
    const r = res();
    await quote({ body: { package_ids: [20], uid: "7", pickup_lat: "23.2", pickup_lng: "77.4" } }, r);
    expect(resolvePickupCityId).toHaveBeenCalledWith(23.2, 77.4);
    expect(prisma.tbl_user.findUnique).not.toHaveBeenCalled();
    expect(svc.quote).toHaveBeenCalledWith([20], { cityId: 5, uid: 7 });
  });
  it("falls back to the customer's city when the pickup city is unknown", async () => {
    svc.quote.mockResolvedValue({ packageId: 20, amount: 100 });
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 2 });
    const r = res();
    await quote({ body: { package_ids: [20], uid: 7, pickup_lat: 23.2, pickup_lng: 77.4 } }, r);
    expect(prisma.tbl_user.findUnique).toHaveBeenCalledWith({ where: { id: 7 }, select: { city_id: true } });
    expect(svc.quote).toHaveBeenCalledWith([20], { cityId: 2, uid: 7 });
  });
  it("falls back to the customer's city when resolving the pickup city throws", async () => {
    svc.quote.mockResolvedValue({ packageId: 20, amount: 100 });
    resolvePickupCityId.mockRejectedValue(new Error("db"));
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 2 });
    const r = res();
    await quote({ body: { package_ids: [20], uid: 7, pickup_lat: 23.2, pickup_lng: 77.4 } }, r);
    expect(svc.quote).toHaveBeenCalledWith([20], { cityId: 2, uid: 7 });
  });
  it("without pickup coordinates does not resolve the pickup city", async () => {
    svc.quote.mockResolvedValue({ packageId: 20, amount: 100 });
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 2 });
    const r = res();
    await quote({ body: { package_ids: [20], uid: 7 } }, r);
    expect(resolvePickupCityId).not.toHaveBeenCalled();
    expect(svc.quote).toHaveBeenCalledWith([20], { cityId: 2, uid: 7 });
  });
  it.each([undefined, null, [], "10", {}])("rejects package_ids=%p with 400", async (bad) => {
    const r = res();
    await quote({ body: { package_ids: bad } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(svc.quote).not.toHaveBeenCalled();
  });
  it("rejects more than 20 package_ids with 400 and never calls the service", async () => {
    const r = res();
    await quote({ body: { package_ids: Array.from({ length: 21 }, (_, i) => i + 1) } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "400", Result: "false", ResponseMsg: "package_ids must have at most 20 entries" });
    expect(svc.quote).not.toHaveBeenCalled();
  });
  it("exactly 20 package_ids passes through", async () => {
    svc.quote.mockResolvedValue({ packageId: 1, amount: 5 });
    const r = res();
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    await quote({ body: { package_ids: ids } }, r);
    expect(svc.quote).toHaveBeenCalledWith(ids, { cityId: null, uid: null });
  });
  it("a service failure is a 500, not a crash", async () => {
    svc.quote.mockRejectedValue(new Error("db"));
    const r = res();
    await quote({ body: { package_ids: [1] } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});
