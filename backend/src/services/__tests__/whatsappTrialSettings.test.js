jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  pkg_order: { count: jest.fn() },
  whatsapp_driver_session: { findUnique: jest.fn(), findMany: jest.fn() },
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
    prisma.whatsapp_driver_session.findMany.mockResolvedValue([{ order_id: 11 }, { order_id: 12 }]);
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
    expect(prisma.whatsapp_driver_session.findMany).toHaveBeenCalledWith({ where: { rider_id: 55 }, select: { order_id: true } });
    expect(prisma.pkg_order.count).toHaveBeenCalledWith({
      where: { id: { in: [11, 12] }, rid: 55, driver_channel: "whatsapp", o_status: "Completed" },
    });
  });
  it("counts only orders this rider ran on WhatsApp: none without a session of theirs", async () => {
    // An app driver who completed a re-lived order still marked driver_channel='whatsapp' has no session.
    prisma.whatsapp_driver_session.findMany.mockResolvedValue([]);
    const r = await settings.eligibility(55);
    expect(r.whatsapp_orders_done).toBe(0);
    expect(prisma.pkg_order.count).not.toHaveBeenCalled();
  });
});

describe("whatsappTrialSettings.isWhatsappDriver", () => {
  beforeEach(() => jest.resetAllMocks());
  const ORDER = { id: 77, rid: 55, driver_channel: "whatsapp" };

  it("is true when the order is WhatsApp-channel and its session belongs to the assigned driver", async () => {
    prisma.whatsapp_driver_session.findUnique.mockResolvedValue({ rider_id: 55 });
    expect(await settings.isWhatsappDriver(ORDER)).toBe(true);
    expect(prisma.whatsapp_driver_session.findUnique).toHaveBeenCalledWith({ where: { order_id: 77 }, select: { rider_id: true } });
  });
  it("is false after the order passed to another driver (re-live / replace): the session is the old driver's", async () => {
    prisma.whatsapp_driver_session.findUnique.mockResolvedValue({ rider_id: 55 });
    expect(await settings.isWhatsappDriver({ ...ORDER, rid: 99 })).toBe(false);
  });
  it("is false with no session, no driver, or an app channel (no session read for those)", async () => {
    prisma.whatsapp_driver_session.findUnique.mockResolvedValue(null);
    expect(await settings.isWhatsappDriver(ORDER)).toBe(false);
    prisma.whatsapp_driver_session.findUnique.mockClear();
    expect(await settings.isWhatsappDriver({ ...ORDER, rid: 0 })).toBe(false);
    expect(await settings.isWhatsappDriver({ ...ORDER, driver_channel: "app" })).toBe(false);
    expect(await settings.isWhatsappDriver(null)).toBe(false);
    expect(prisma.whatsapp_driver_session.findUnique).not.toHaveBeenCalled();
  });
  it("uses a session the caller already loaded instead of reading it again", async () => {
    expect(await settings.isWhatsappDriver(ORDER, { rider_id: 55 })).toBe(true);
    expect(await settings.isWhatsappDriver(ORDER, { rider_id: 54 })).toBe(false);
    expect(await settings.isWhatsappDriver(ORDER, null)).toBe(false);
    expect(prisma.whatsapp_driver_session.findUnique).not.toHaveBeenCalled();
  });
});
