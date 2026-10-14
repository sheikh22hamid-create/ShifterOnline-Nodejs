jest.mock("../../config/db", () => ({ tbl_rider: { findMany: jest.fn() }, tbl_user: { findMany: jest.fn() } }));

const prisma = require("../../config/db");
const { callerCity, assertRiderInScope, assertUserInScope, filterByRider } = require("../cityScope");

const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const as = (role, city_id) => ({ user: { role, city_id } });
beforeEach(() => jest.clearAllMocks());

describe("callerCity", () => {
  it("is unrestricted for a superadmin and the token city for admin/executive", () => {
    expect(callerCity(as("superadmin", null))).toBeNull();
    expect(callerCity(as("admin", 3))).toBe(3);
    expect(callerCity(as("executive", "4"))).toBe(4);
  });
  it("fails closed (0) for a city-bound role with no valid city", () => {
    expect(callerCity(as("admin", null))).toBe(0);
    expect(callerCity(as("executive", "abc"))).toBe(0);
  });
});

describe("assertRiderInScope", () => {
  it("lets a superadmin through without a lookup", async () => {
    expect(await assertRiderInScope(as("superadmin"), res(), 9)).toBe(true);
    expect(prisma.tbl_rider.findMany).not.toHaveBeenCalled();
  });
  it("allows a driver of the caller's own city", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, city_id: 3 }]);
    expect(await assertRiderInScope(as("admin", 3), res(), 9)).toBe(true);
  });
  it("rejects a driver of another city with 403", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, city_id: 4 }]);
    const r = res();
    expect(await assertRiderInScope(as("admin", 3), r, 9)).toBe(false);
    expect(r.status).toHaveBeenCalledWith(403);
  });
  it("404s an unknown driver and never leaks it to a city-bound caller with no city", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    const r = res();
    expect(await assertRiderInScope(as("admin", 3), r, 9)).toBe(false);
    expect(r.status).toHaveBeenCalledWith(404);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, city_id: 3 }]);
    expect(await assertRiderInScope(as("executive", null), res(), 9)).toBe(false);
  });
});

describe("assertUserInScope / filterByRider", () => {
  it("checks customers against tbl_user", async () => {
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 5, city_id: 2 }]);
    expect(await assertUserInScope(as("admin", 2), res(), 5)).toBe(true);
    expect(prisma.tbl_user.findMany).toHaveBeenCalled();
  });
  it("keeps only rows of the caller's city and everything for a superadmin", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 1, city_id: 3 }, { id: 2, city_id: 4 }]);
    const rows = [{ rider_id: 1 }, { rider_id: 2 }, { rider_id: 7 }];
    expect(await filterByRider(as("admin", 3), rows)).toEqual([{ rider_id: 1 }]);
    expect(await filterByRider(as("superadmin"), rows)).toEqual(rows);
  });
});
