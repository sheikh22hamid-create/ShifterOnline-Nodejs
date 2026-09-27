jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
}));
jest.mock("../../utils/assignDefaultDeliveryTypes", () => ({ assignDefaultDeliveryTypes: jest.fn().mockResolvedValue(undefined) }));

const prisma = require("../../config/db");
const { list, create, block, remove, upgrade } = require("../adminTrialDriverController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}
const adminReq = (body = {}, params = {}) => ({ body, params, user: { id: 1, role: "superadmin" } });

describe("adminTrialDriverController.create", () => {
  afterEach(() => jest.clearAllMocks());

  it("rejects a non-positive trial order count", async () => {
    const res = makeRes();
    await create(adminReq({ full_name: "Raju", fmobile: "9998887777", vehicle: "Bike", trial_orders_allowed: 0 }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_rider.create).not.toHaveBeenCalled();
  });

  it("rejects re-adding a driver who is already in an active trial", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 4, fmobile: "9998887777", trial_status: "active" });
    const res = makeRes();
    await create(adminReq({ full_name: "Raju", fmobile: "9998887777", vehicle: "Bike", trial_orders_allowed: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.create).not.toHaveBeenCalled();
  });

  it("creates a new trial rider by mobile when none exists", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    prisma.tbl_rider.create.mockResolvedValue({ id: 10, full_name: "Raju", fmobile: "9998887777" });
    const res = makeRes();
    await create(adminReq({ full_name: "Raju", fmobile: "9998887777", vehicle: "Bike", trial_orders_allowed: 5, city_id: 1 }), res);
    expect(prisma.tbl_rider.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ trial_status: "active", trial_orders_allowed: 5, fmobile: "9998887777", vehicle: "Bike" }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("activates trial on an existing (previously non-trial) rider found by mobile", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 4, fmobile: "9998887777", trial_status: "none" });
    prisma.tbl_rider.update.mockResolvedValue({ id: 4, full_name: "Raju", fmobile: "9998887777" });
    const res = makeRes();
    await create(adminReq({ full_name: "Raju", fmobile: "9998887777", vehicle: "Bike", trial_orders_allowed: 5 }), res);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: expect.objectContaining({ trial_status: "active", trial_orders_allowed: 5, trial_orders_completed: 0 }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("adminTrialDriverController.block/remove/upgrade", () => {
  afterEach(() => jest.clearAllMocks());

  it("block sets trial_status=blocked and a_status=0", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 4, city_id: 1 });
    prisma.tbl_rider.update.mockResolvedValue({ id: 4 });
    const res = makeRes();
    await block(adminReq({}, { id: "4" }), res);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { trial_status: "blocked", a_status: 0 } });
  });

  it("remove sets trial_status=none and a_status=0", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 4, city_id: 1 });
    prisma.tbl_rider.update.mockResolvedValue({ id: 4 });
    const res = makeRes();
    await remove(adminReq({}, { id: "4" }), res);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { trial_status: "none", a_status: 0 } });
  });

  it("upgrade approves KYC and marks trial_status=upgraded without touching a_status", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 4, city_id: 1, a_status: 1 });
    prisma.tbl_rider.update.mockResolvedValue({ id: 4 });
    const res = makeRes();
    await upgrade(adminReq({}, { id: "4" }), res);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { verification_status: "approved", all_verify: 1, payment_complete: 1, trial_status: "upgraded" },
    });
  });

  it("returns 404 for an unknown rider id on block", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await block(adminReq({}, { id: "999" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("adminTrialDriverController.list", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns only riders with a non-none trial_status", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 4, trial_status: "active" }]);
    const res = makeRes();
    await list(adminReq(), res);
    expect(prisma.tbl_rider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ trial_status: { not: "none" } }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
