jest.mock("../../config/db", () => ({
  guarantee_outside_candidate: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const svc = require("../guaranteeOutsideCandidateService");

const model = prisma.guarantee_outside_candidate;
beforeEach(() => jest.resetAllMocks());

const driver = { name: "Rakesh Kumar", mobile: "9876543210", vehicle_number: "MP09 AB 1234", vehicle_name: "Bike", fare: 120 };

describe("createLive", () => {
  it("inserts a ready, active candidate and returns it", async () => {
    model.create.mockResolvedValue({ id: 5 });
    const out = await svc.createLive({ caseId: 1, orderId: 9, riderId: 44, driver });
    expect(out).toEqual({ created: true, row: { id: 5 } });
    expect(model.create.mock.calls[0][0].data).toMatchObject({ case_id: 1, order_id: 9, rider_id: 44, mobile: "9876543210", status: "ready", active: 1 });
  });
  it("returns created:false on a unique violation (live candidate exists or driver already offered)", async () => {
    model.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await svc.createLive({ caseId: 1, orderId: 9, riderId: 44, driver })).toEqual({ created: false, row: null });
  });
  it("rethrows any other error", async () => {
    model.create.mockRejectedValue(new Error("db down"));
    await expect(svc.createLive({ caseId: 1, orderId: 9, riderId: 44, driver })).rejects.toThrow("db down");
  });
});

describe("getLive", () => {
  it("reads the active candidate of the case", async () => {
    model.findFirst.mockResolvedValue({ id: 5 });
    expect(await svc.getLive(1)).toEqual({ id: 5 });
    expect(model.findFirst.mock.calls[0][0].where).toEqual({ case_id: 1, active: 1 });
  });
});

describe("hasOffered", () => {
  it("matches by mobile or by plate across every status", async () => {
    model.findFirst.mockResolvedValue({ id: 1 });
    expect(await svc.hasOffered(1, { mobile: "9876543210", vehicleNumber: " mp09 ab 1234 " })).toBe(true);
    const where = model.findFirst.mock.calls[0][0].where;
    expect(where.case_id).toBe(1);
    expect(where.OR).toEqual([{ mobile: "9876543210" }, { vehicle_number: "MP09 AB 1234" }]);
  });
  it("an empty plate never matches (only the mobile is compared)", async () => {
    model.findFirst.mockResolvedValue(null);
    expect(await svc.hasOffered(1, { mobile: "9876543210", vehicleNumber: "  " })).toBe(false);
    expect(model.findFirst.mock.calls[0][0].where.OR).toEqual([{ mobile: "9876543210" }]);
  });
});

describe("hasOfferedRider", () => {
  it("is true when any candidate of the case already points at that trial rider", async () => {
    model.findFirst.mockResolvedValue({ id: 1 });
    expect(await svc.hasOfferedRider(1, 44)).toBe(true);
    expect(model.findFirst.mock.calls[0][0].where).toEqual({ case_id: 1, rider_id: 44 });
  });
  it("is false when none does", async () => {
    model.findFirst.mockResolvedValue(null);
    expect(await svc.hasOfferedRider(1, 44)).toBe(false);
  });
});

describe("reject", () => {
  it("flips only a ready live candidate and clears active (never 0)", async () => {
    model.updateMany.mockResolvedValue({ count: 1 });
    expect(await svc.reject({ caseId: 1, adminId: 7, reason: "not suitable" })).toBe(true);
    const call = model.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ case_id: 1, active: 1, status: "ready" });
    expect(call.data).toMatchObject({ status: "rejected", active: null, rejected_by: 7, reject_reason: "not suitable" });
    expect(call.data.rejected_at).toBeInstanceOf(Date);
  });
  it("returns false when nothing matched (already rejected or assigned)", async () => {
    model.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.reject({ caseId: 1, adminId: 7 })).toBe(false);
  });
  it("truncates the reason to 200 characters", async () => {
    model.updateMany.mockResolvedValue({ count: 1 });
    await svc.reject({ caseId: 1, adminId: 7, reason: "x".repeat(500) });
    expect(model.updateMany.mock.calls[0][0].data.reject_reason).toHaveLength(200);
  });
});

describe("markAssigned / supersedeLive", () => {
  it("markAssigned flips the live candidate of that rider to assigned", async () => {
    model.updateMany.mockResolvedValue({ count: 1 });
    expect(await svc.markAssigned(1, 44)).toBe(true);
    expect(model.updateMany.mock.calls[0][0]).toMatchObject({ where: { case_id: 1, rider_id: 44, active: 1 }, data: { status: "assigned", active: null } });
  });
  it("supersedeLive only touches the live row and returns the count", async () => {
    model.updateMany.mockResolvedValue({ count: 1 });
    expect(await svc.supersedeLive(1, "order_closed")).toBe(1);
    expect(model.updateMany.mock.calls[0][0]).toMatchObject({ where: { case_id: 1, active: 1 }, data: { status: "superseded", active: null, reject_reason: "order_closed" } });
  });
});
