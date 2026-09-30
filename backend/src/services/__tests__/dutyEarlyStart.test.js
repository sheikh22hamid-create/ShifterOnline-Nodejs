jest.mock("../../config/db", () => ({
  monthly_driver_contract: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  service_zone: { findUnique: jest.fn() },
  duty_early_start_request: { findUnique: jest.fn(), create: jest.fn() },
  driver_duty_log: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock("../geofenceService", () => ({ isInsideZone: jest.fn().mockReturnValue(true) }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const prisma = require("../../config/db");
const { punchIn } = require("../dutyTrackingService");

// 2026-09-30 03:30 UTC = 09:00 IST (before a 10:00 shift start);
// 05:00 UTC = 10:30 IST (after it).
const BEFORE_SHIFT = new Date("2026-09-30T03:30:00.000Z").getTime();
const AFTER_SHIFT = new Date("2026-09-30T05:00:00.000Z").getTime();

describe("monthly driver punchIn gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.monthly_driver_contract.findUnique.mockResolvedValue({ rider_id: 4, status: "active", shift_start_time: "10:00:00", assigned_zone_id: null });
    prisma.tbl_rider.findUnique.mockResolvedValue({ a_status: 1 });
    prisma.driver_duty_log.findFirst.mockResolvedValue(null);
    prisma.driver_duty_log.create.mockResolvedValue({ id: 1, status: "in_progress" });
    prisma.duty_early_start_request.findUnique.mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  it("refuses to start duty while the driver is offline", async () => {
    jest.spyOn(Date, "now").mockReturnValue(AFTER_SHIFT);
    prisma.tbl_rider.findUnique.mockResolvedValue({ a_status: 0 });
    await expect(punchIn(4, 0, 0)).rejects.toThrow(/go online/i);
    expect(prisma.driver_duty_log.create).not.toHaveBeenCalled();
  });

  it("starts duty normally once the shift time has arrived", async () => {
    jest.spyOn(Date, "now").mockReturnValue(AFTER_SHIFT);
    const result = await punchIn(4, 0, 0);
    expect(result.success).toBe(true);
    expect(prisma.duty_early_start_request.create).not.toHaveBeenCalled();
  });

  it("files an early-start request and blocks when punching in before the shift start", async () => {
    jest.spyOn(Date, "now").mockReturnValue(BEFORE_SHIFT);
    await expect(punchIn(4, 0, 0)).rejects.toThrow(/request has been sent to the admin/i);
    expect(prisma.duty_early_start_request.create).toHaveBeenCalledWith({ data: { rider_id: 4, duty_date: expect.any(Date) } });
    expect(prisma.driver_duty_log.create).not.toHaveBeenCalled();
  });

  it("keeps blocking while the early-start request is still pending (no duplicate request)", async () => {
    jest.spyOn(Date, "now").mockReturnValue(BEFORE_SHIFT);
    prisma.duty_early_start_request.findUnique.mockResolvedValue({ status: "pending" });
    await expect(punchIn(4, 0, 0)).rejects.toThrow(/waiting for admin approval/i);
    expect(prisma.duty_early_start_request.create).not.toHaveBeenCalled();
  });

  it("blocks when the admin declined", async () => {
    jest.spyOn(Date, "now").mockReturnValue(BEFORE_SHIFT);
    prisma.duty_early_start_request.findUnique.mockResolvedValue({ status: "rejected" });
    await expect(punchIn(4, 0, 0)).rejects.toThrow(/declined/i);
  });

  it("lets the driver start early once the admin approved", async () => {
    jest.spyOn(Date, "now").mockReturnValue(BEFORE_SHIFT);
    prisma.duty_early_start_request.findUnique.mockResolvedValue({ status: "approved" });
    const result = await punchIn(4, 0, 0);
    expect(result.success).toBe(true);
    expect(prisma.driver_duty_log.create).toHaveBeenCalled();
  });
});
