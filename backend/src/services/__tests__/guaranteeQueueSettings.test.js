jest.mock("../../config/db", () => ({
  city_order_settings: { findUnique: jest.fn(), upsert: jest.fn() },
  tbl_city: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../guaranteeQueueSettings");

beforeEach(() => { jest.clearAllMocks(); settings._resetCache(); });

describe("getQueueSettings", () => {
  it("is OFF with defaults for a missing city or row", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue(null);
    expect((await settings.getQueueSettings(3)).execQueueEnabled).toBe(false);
    expect((await settings.getQueueSettings(null)).execQueueEnabled).toBe(false);
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(1);
  });
  it("fails closed (disabled) on a read error", async () => {
    prisma.city_order_settings.findUnique.mockRejectedValue(new Error("db down"));
    const s = await settings.getQueueSettings(3);
    expect(s).toMatchObject({ execQueueEnabled: false, execDefaultCapacity: 5 });
  });
  it("caches for a few seconds and bypasses the cache with fresh:true", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ exec_queue_enabled: 1, exec_default_capacity: 7, reminder_pct: 50, escalate_pct: 75 });
    expect((await settings.getQueueSettings(3)).execDefaultCapacity).toBe(7);
    await settings.getQueueSettings(3);
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(1);
    await settings.getQueueSettings(3, { fresh: true });
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("saveQueueSettings", () => {
  it("rejects an unknown city with a 400 and writes nothing", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue(null);
    await expect(settings.saveQueueSettings({ cityId: 99, input: { execQueueEnabled: true }, adminId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.city_order_settings.upsert).not.toHaveBeenCalled();
  });
  it("validates against the CURRENT values (reminder must stay below escalation), then upserts only the sent columns", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    prisma.city_order_settings.findUnique.mockResolvedValue({ exec_queue_enabled: 0, exec_default_capacity: 5, reminder_pct: 50, escalate_pct: 75 });
    await expect(settings.saveQueueSettings({ cityId: 3, input: { reminderPct: 90 }, adminId: 1 })).rejects.toMatchObject({ statusCode: 400 });

    prisma.city_order_settings.upsert.mockResolvedValue({});
    await settings.saveQueueSettings({ cityId: 3, input: { execQueueEnabled: true, execDefaultCapacity: 6 }, adminId: 12 });
    const arg = prisma.city_order_settings.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ city_id: 3 });
    expect(arg.update).toMatchObject({ exec_queue_enabled: true, exec_default_capacity: 6, updated_by: 12 });
    expect(arg.update).not.toHaveProperty("reminder_pct");
    expect(arg.create).toMatchObject({ city_id: 3, exec_queue_enabled: true, exec_default_capacity: 6 });
  });
});
