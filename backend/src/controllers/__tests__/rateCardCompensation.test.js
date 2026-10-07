jest.mock("../../config/db", () => ({
  tbl_package: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  pkg_category: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const { create, update, _validateCompensation } = require("../rateCardController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => jest.clearAllMocks());

describe("_validateCompensation", () => {
  it.each([undefined, 0, "0", 100, "250.50"])("accepts %p", (v) => expect(_validateCompensation(v)).toBeNull());
  it.each([-1, "-5", "abc", NaN, 1e12])("rejects %p", (v) => expect(typeof _validateCompensation(v)).toBe("string"));
});

describe("rate card endpoints reject a bad no_driver_compensation before touching the DB", () => {
  const body = { title: "Model 2", type: "USER", cat_id: 1, city_id: 1, min_charge: 10, per_km_charge: 5, free_waiting_time: 5, waiting_charge: 1, start_time: "00:00", end_time: "23:59" };

  it("create -> 400", async () => {
    const r = res();
    await create({ body: { ...body, no_driver_compensation: -10 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_package.create).not.toHaveBeenCalled();
  });
  it("update -> 400", async () => {
    prisma.tbl_package.findUnique.mockResolvedValue({ id: 1 });
    const r = res();
    await update({ params: { id: "1" }, body: { no_driver_compensation: "abc" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_package.update).not.toHaveBeenCalled();
  });
  it("update with a valid value passes it through to the DB", async () => {
    prisma.tbl_package.findUnique.mockResolvedValue({ id: 1 });
    prisma.tbl_package.update.mockResolvedValue({ id: 1 });
    prisma.pkg_category.findUnique.mockResolvedValue({ id: 1 });
    await update({ params: { id: "1" }, body: { no_driver_compensation: "500" } }, res());
    expect(prisma.tbl_package.update.mock.calls[0][0].data.no_driver_compensation).toBe("500");
  });
});
