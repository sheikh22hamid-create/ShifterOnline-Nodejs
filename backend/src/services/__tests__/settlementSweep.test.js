jest.mock("../../config/db", () => ({
  order_settlement: { findMany: jest.fn(), updateMany: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock("../settlementSettings", () => ({ getSettlementSettings: jest.fn() }));
jest.mock("../pushNotifier", () => ({
  notifyCustomerSettlementReminder: jest.fn().mockResolvedValue({ sent: true }),
  notifyDriverSettlementReminder: jest.fn().mockResolvedValue({ sent: true }),
}));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const { getSettlementSettings } = require("../settlementSettings");
const pushNotifier = require("../pushNotifier");
const { sweepSettlements } = require("../settlementSweep");

const NOW = new Date("2026-10-04T12:00:00Z");
const minsAgo = (m) => new Date(NOW.getTime() - m * 60000);
const pending = (o = {}) => ({ id: 1, order_id: 50, uid: 7, rid: 9, amount_due: 85, status: "pending", reminders_sent: 0, escalated_at: null, pending_since: minsAgo(0), ...o });

describe("sweepSettlements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSettlementSettings.mockResolvedValue({ enabled: true, reminderMinutes: [10, 30], escalateAfterMinutes: 60 });
    prisma.order_settlement.updateMany.mockResolvedValue({ count: 1 });
    prisma.order_settlement_event.create.mockResolvedValue({});
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-token" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "drv-token" });
  });

  it("does nothing when the feature is off", async () => {
    getSettlementSettings.mockResolvedValue({ enabled: false, reminderMinutes: [10], escalateAfterMinutes: 60 });
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(prisma.order_settlement.findMany).not.toHaveBeenCalled();
  });

  it("sends nothing before the first threshold", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(5) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(pushNotifier.notifyCustomerSettlementReminder).not.toHaveBeenCalled();
  });

  it("sends one reminder to both parties at the first threshold and stamps the counter", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(11) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 1, escalated: 0 });
    expect(prisma.order_settlement.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: "pending", reminders_sent: 0 },
      data: { reminders_sent: 1, last_reminder_at: NOW, updated_at: NOW },
    });
    expect(pushNotifier.notifyCustomerSettlementReminder).toHaveBeenCalledWith("cust-token", 50, 85);
    expect(pushNotifier.notifyDriverSettlementReminder).toHaveBeenCalledWith("drv-token", 50, 85);
  });

  it("does not resend a threshold that was already sent (restart / overlapping run)", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(11), reminders_sent: 1 })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(pushNotifier.notifyCustomerSettlementReminder).not.toHaveBeenCalled();
  });

  it("skips the push when another sweep already claimed this reminder (updateMany matched 0 rows)", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(11) })]);
    prisma.order_settlement.updateMany.mockResolvedValue({ count: 0 });
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(pushNotifier.notifyCustomerSettlementReminder).not.toHaveBeenCalled();
  });

  it("sends one catch-up reminder (not two) when two thresholds passed while the server was down", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(45) })]);
    expect((await sweepSettlements(NOW)).reminded).toBe(1);
    expect(prisma.order_settlement.updateMany.mock.calls[0][0].data.reminders_sent).toBe(2);
    expect(pushNotifier.notifyCustomerSettlementReminder).toHaveBeenCalledTimes(1);
  });

  it("escalates once at the escalation threshold, with an audit event", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(61), reminders_sent: 2 })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 1 });
    expect(prisma.order_settlement.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: "pending", escalated_at: null },
      data: { escalated_at: NOW, updated_at: NOW },
    });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ settlement_id: 1, actor: "system", from_status: "pending", to_status: "pending" }),
    });
  });

  it("does not re-escalate an already escalated settlement", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(90), reminders_sent: 2, escalated_at: minsAgo(30) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(prisma.order_settlement.updateMany).not.toHaveBeenCalled();
  });

  it("an empty reminder list means no reminders but escalation still happens", async () => {
    getSettlementSettings.mockResolvedValue({ enabled: true, reminderMinutes: [], escalateAfterMinutes: 60 });
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(70) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 1 });
  });

  it("a missing push token never blocks the sweep", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(11) })]);
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: null });
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 1, escalated: 0 });
    expect(pushNotifier.notifyCustomerSettlementReminder).not.toHaveBeenCalled();
    expect(pushNotifier.notifyDriverSettlementReminder).not.toHaveBeenCalled();
  });
  it("only fetches rows that still have sweep work to do", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([]);
    await sweepSettlements(NOW);
    expect(prisma.order_settlement.findMany).toHaveBeenCalledWith({
      where: { status: "pending", OR: [{ escalated_at: null }, { reminders_sent: { lt: 2 } }] },
      orderBy: { pending_since: "asc" },
      take: 200,
    });
    getSettlementSettings.mockResolvedValue({ enabled: true, reminderMinutes: [], escalateAfterMinutes: 60 });
    await sweepSettlements(NOW);
    expect(prisma.order_settlement.findMany.mock.calls[1][0].where.OR[1]).toEqual({ reminders_sent: { lt: 0 } });
  });

  it("isolates a failing row: the next row is still processed and the error is logged", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([
      pending({ id: 1, pending_since: minsAgo(11) }),
      pending({ id: 2, pending_since: minsAgo(11) }),
    ]);
    prisma.order_settlement.updateMany.mockRejectedValueOnce(new Error("db down"));
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 1, escalated: 0 });
    expect(logger.error).toHaveBeenCalled();
    expect(prisma.order_settlement.updateMany).toHaveBeenCalledTimes(2);
  });

  it("a push rejection or sync throw does not break the sweep; escalation still runs", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(61) })]);
    pushNotifier.notifyCustomerSettlementReminder.mockRejectedValueOnce(new Error("fcm down"));
    pushNotifier.notifyDriverSettlementReminder.mockImplementationOnce(() => { throw new Error("sync boom"); });
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 1, escalated: 1 });
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("does both the reminder and the escalation for one row in the same pass", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(61) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 1, escalated: 1 });
  });
});
