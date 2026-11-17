jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  pkg_order: { count: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../whatsapp/client", () => ({ getBotStatus: jest.fn() }));

const prisma = require("../../config/db");
const { getBotStatus } = require("../../whatsapp/client");
const settings = require("../whatsappTrialSettings");

const setSwitch = (v) => prisma.app_settings.findFirst.mockResolvedValue(v === null ? null : { setting_value: v });

describe("whatsappTrialSettings.isEnabled", () => {
  beforeEach(() => jest.resetAllMocks());

  it("is off when the row is missing", async () => {
    setSwitch(null);
    expect(await settings.isEnabled()).toBe(false);
  });
  it("is off for '0'", async () => {
    setSwitch("0");
    expect(await settings.isEnabled()).toBe(false);
  });
  it("is off when the read throws", async () => {
    prisma.app_settings.findFirst.mockRejectedValue(new Error("db down"));
    expect(await settings.isEnabled()).toBe(false);
  });
  it.each(["1", "true", " ON "])("is on for %p", async (v) => {
    setSwitch(v);
    expect(await settings.isEnabled()).toBe(true);
  });
});

describe("whatsappTrialSettings.eligibility", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setSwitch("1");
    getBotStatus.mockReturnValue({ status: "CONNECTED" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 55, trial_status: "active" });
    prisma.pkg_order.count.mockResolvedValue(2);
  });

  it("is not eligible when the switch is off", async () => {
    setSwitch("0");
    const r = await settings.eligibility(55);
    expect(r).toMatchObject({ eligible: false, reason: "disabled", enabled: false });
  });
  it("is not eligible when the bot is offline", async () => {
    getBotStatus.mockReturnValue({ status: "DISCONNECTED" });
    const r = await settings.eligibility(55);
    expect(r).toMatchObject({ eligible: false, reason: "bot_offline", bot_connected: false, enabled: true });
  });
  it("is not eligible when the rider is not found", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    expect(await settings.eligibility(55)).toMatchObject({ eligible: false, reason: "not_found" });
  });
  it("is not eligible when the rider is not an active trial driver", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 55, trial_status: "passed" });
    expect(await settings.eligibility(55)).toMatchObject({ eligible: false, reason: "not_trial" });
  });
  it("is eligible and counts completed WhatsApp orders", async () => {
    const r = await settings.eligibility(55);
    expect(r).toEqual({ eligible: true, reason: null, whatsapp_orders_done: 2, bot_connected: true, enabled: true });
    expect(prisma.pkg_order.count).toHaveBeenCalledWith({ where: { rid: 55, driver_channel: "whatsapp", o_status: "Completed" } });
  });
});
