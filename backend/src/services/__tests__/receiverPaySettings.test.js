jest.mock("../../config/db", () => ({ app_settings: { findMany: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../settlementSettings", () => ({ isSettlementEnabled: jest.fn() }));

const prisma = require("../../config/db");
const settlementSettings = require("../settlementSettings");
const { getReceiverPaySettings, isReceiverPayAvailable, DEFAULTS } = require("../receiverPaySettings");

const rows = (o) => Object.entries(o).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));

describe("receiverPaySettings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("defaults: off, 5%, no rupee cap, 24h", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await getReceiverPaySettings()).toEqual({ enabled: false, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 });
    expect(DEFAULTS.enabled).toBe(false);
  });
  it("reads configured values", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      receiver_pay_enabled: "1", receiver_commission_max_percent: "10", receiver_commission_max_amount: "50", receiver_pay_link_ttl_hours: "12",
    }));
    expect(await getReceiverPaySettings()).toEqual({ enabled: true, maxPercent: 10, maxAmount: 50, linkTtlHours: 12 });
  });
  it("falls back per key on bad values (a 0 rupee cap stays valid = no cap)", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      receiver_pay_enabled: "yes", receiver_commission_max_percent: "-3", receiver_commission_max_amount: "0", receiver_pay_link_ttl_hours: "abc",
    }));
    expect(await getReceiverPaySettings()).toEqual({ enabled: true, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 });
  });
  it("fails closed when the DB read throws", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    expect((await getReceiverPaySettings()).enabled).toBe(false);
  });
  it("available only when both receiver-pay and settlement are on", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({ receiver_pay_enabled: "1" }));
    settlementSettings.isSettlementEnabled.mockResolvedValue(false);
    expect(await isReceiverPayAvailable()).toBe(false);
    settlementSettings.isSettlementEnabled.mockResolvedValue(true);
    expect(await isReceiverPayAvailable()).toBe(true);
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await isReceiverPayAvailable()).toBe(false);
  });
});
