jest.mock("../../config/db", () => ({
  tbl_user_blocked_driver: { findUnique: jest.fn(), delete: jest.fn(), count: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  tbl_favorite_driver: { updateMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  app_settings: { findFirst: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const prisma = require("../../config/db");
const { toggleBlockedDriver, listBlockedDrivers } = require("../blockedDriverController");

function res() {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
}

describe("toggleBlockedDriver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_user_blocked_driver.findUnique.mockResolvedValue(null);
    prisma.tbl_user_blocked_driver.count.mockResolvedValue(0);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "2" });
  });

  it("requires user_id and rider_id", async () => {
    const r = res();
    await toggleBlockedDriver({ body: {} }, r);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("blocks a driver and drops them from the user's favourites", async () => {
    const r = res();
    await toggleBlockedDriver({ body: { user_id: 3, rider_id: 9 } }, r);
    expect(prisma.tbl_user_blocked_driver.create).toHaveBeenCalledWith({ data: { user_id: 3, rider_id: 9 } });
    expect(prisma.tbl_favorite_driver.updateMany).toHaveBeenCalledWith({ where: { user_id: 3, rider_id: 9 }, data: { status: 0 } });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true, blocked: true }));
  });

  it("refuses once the admin-decided limit is reached", async () => {
    prisma.tbl_user_blocked_driver.count.mockResolvedValue(2);
    const r = res();
    await toggleBlockedDriver({ body: { user_id: 3, rider_id: 9 } }, r);
    expect(prisma.tbl_user_blocked_driver.create).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false, msg: expect.stringContaining("up to 2") }));
  });

  it("a limit of 0 turns blocking off", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "0" });
    const r = res();
    await toggleBlockedDriver({ body: { user_id: 3, rider_id: 9 } }, r);
    expect(prisma.tbl_user_blocked_driver.create).not.toHaveBeenCalled();
  });

  it("defaults to 3 when the admin has not set a limit", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    prisma.tbl_user_blocked_driver.count.mockResolvedValue(2);
    const r = res();
    await toggleBlockedDriver({ body: { user_id: 3, rider_id: 9 } }, r);
    expect(prisma.tbl_user_blocked_driver.create).toHaveBeenCalled();
  });

  it("unblocks an already-blocked driver", async () => {
    prisma.tbl_user_blocked_driver.findUnique.mockResolvedValue({ id: 5 });
    const r = res();
    await toggleBlockedDriver({ body: { user_id: 3, rider_id: 9 } }, r);
    expect(prisma.tbl_user_blocked_driver.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true, blocked: false }));
  });
});

describe("listBlockedDrivers", () => {
  it("returns names and the admin limit", async () => {
    prisma.tbl_user_blocked_driver.findMany.mockResolvedValue([{ rider_id: 9 }]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, first_name: "Ravi", last_name: "K", vehicle: "Bike" }]);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "4" });
    const r = res();
    await listBlockedDrivers({ body: { user_id: 3 } }, r);
    expect(r.json).toHaveBeenCalledWith({ Result: true, max_blocked: 4, data: [{ id: 9, name: "Ravi K", vehicle: "Bike" }] });
  });
});
