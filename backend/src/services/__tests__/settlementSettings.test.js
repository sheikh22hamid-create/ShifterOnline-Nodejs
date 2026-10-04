jest.mock("../../config/db", () => ({ app_settings: { findMany: jest.fn() } }));
const prisma = require("../../config/db");
const { getSettlementSettings, isSettlementEnabled, DEFAULTS } = require("../settlementSettings");

const rows = (obj) => Object.entries(obj).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));

describe("settlementSettings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is disabled with default timings when nothing is configured", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await getSettlementSettings()).toEqual({
      enabled: false, reminderMinutes: [10, 30], escalateAfterMinutes: 60,
      driverBlockGraceMinutes: 10, disputeWindowHours: 48,
    });
  });

  it("parses admin values", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      settlement_enabled: "1", settlement_reminder_minutes: "5, 15,45",
      settlement_escalate_after_minutes: "90", settlement_driver_block_grace_minutes: "20",
      settlement_dispute_window_hours: "24",
    }));
    expect(await getSettlementSettings()).toEqual({
      enabled: true, reminderMinutes: [5, 15, 45], escalateAfterMinutes: 90,
      driverBlockGraceMinutes: 20, disputeWindowHours: 24,
    });
  });

  it("treats true/on/yes as enabled and anything else as disabled", async () => {
    for (const [v, expected] of [["true", true], ["on", true], ["yes", true], ["0", false], ["off", false], ["", false]]) {
      prisma.app_settings.findMany.mockResolvedValue(rows({ settlement_enabled: v }));
      expect(await isSettlementEnabled()).toBe(expected);
    }
  });

  it("an explicitly empty reminder list means no reminders; junk entries are dropped, list sorted and de-duplicated", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({ settlement_reminder_minutes: "" }));
    expect((await getSettlementSettings()).reminderMinutes).toEqual([]);
    prisma.app_settings.findMany.mockResolvedValue(rows({ settlement_reminder_minutes: "30,abc,-5,10,30,0" }));
    expect((await getSettlementSettings()).reminderMinutes).toEqual([10, 30]);
  });

  it("falls back to defaults for non-positive or non-numeric thresholds", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      settlement_escalate_after_minutes: "0", settlement_driver_block_grace_minutes: "x", settlement_dispute_window_hours: "-1",
    }));
    const s = await getSettlementSettings();
    expect(s.escalateAfterMinutes).toBe(DEFAULTS.escalateAfterMinutes);
    expect(s.driverBlockGraceMinutes).toBe(DEFAULTS.driverBlockGraceMinutes);
    expect(s.disputeWindowHours).toBe(DEFAULTS.disputeWindowHours);
  });

  it("fails closed (disabled) when the settings read throws", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    expect((await getSettlementSettings()).enabled).toBe(false);
    expect(await isSettlementEnabled()).toBe(false);
  });
});
