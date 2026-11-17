// WhatsApp Trial Order, Task 8: the watchdog that alerts the executive when a WhatsApp driver goes silent on a
// step, or when the bot is disconnected while a WhatsApp order is active.
jest.mock("../../config/db", () => ({
  pkg_order: { findMany: jest.fn() },
  whatsapp_driver_session: { findMany: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../client", () => ({ getBotStatus: jest.fn() }));
jest.mock("../driverOrder/flow", () => ({ loadContext: jest.fn() }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const adminSocket = require("../../sockets/adminSocket");
const client = require("../client");
const flow = require("../driverOrder/flow");
const watchdog = require("../driverOrder/watchdog");

const T0 = new Date("2026-11-17T10:00:00Z").getTime();
const MIN = 60 * 1000;
let sessions;
let steps;

const ctx = (orderId) => ({
  order: { id: orderId },
  riderId: 55,
  step: steps[orderId],
  session: sessions[orderId],
});

beforeEach(() => {
  jest.resetAllMocks();
  watchdog._reset();
  sessions = {
    1: { order_id: 1, rider_id: 55, last_reply_at: new Date(T0), last_prompt_at: new Date(T0 - 2 * MIN), created_at: new Date(T0 - 5 * MIN), alerted_step: null },
  };
  steps = { 1: { key: "go_pickup" } };
  prisma.pkg_order.findMany.mockResolvedValue([{ id: 1, city_id: 3, rid: 55 }]);
  prisma.whatsapp_driver_session.findMany.mockImplementation(async () =>
    Object.keys(sessions).map((id) => ({ order_id: Number(id), rider_id: sessions[id].rider_id })));
  prisma.whatsapp_driver_session.updateMany.mockImplementation(async ({ where, data }) => {
    Object.assign(sessions[where.order_id], data);
    return { count: 1 };
  });
  flow.loadContext.mockImplementation(async (id) => (sessions[id] ? ctx(id) : { order: { id }, step: steps[id] || { key: "go_pickup" }, session: null }));
  client.getBotStatus.mockReturnValue({ status: "CONNECTED" });
});

const silentAlerts = () => adminSocket.notifyDispatchAlert.mock.calls.filter(([, , , extra]) => extra?.kind === "whatsapp_driver_silent");
const offlineAlerts = () => adminSocket.notifyDispatchAlert.mock.calls.filter(([, , , extra]) => extra?.kind === "whatsapp_bot_offline");

describe("silence alert", () => {
  it("is driven by the session table: active trips fetched by primary key only", async () => {
    sessions[7] = { order_id: 7 };
    await watchdog.tick(T0);
    expect(prisma.whatsapp_driver_session.findMany).toHaveBeenCalledWith({ select: { order_id: true, rider_id: true } });
    expect(prisma.pkg_order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [1, 7] }, driver_channel: "whatsapp", order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
    }));
  });

  it("no sessions: no order query at all", async () => {
    sessions = {};
    await watchdog.tick(T0);
    expect(prisma.pkg_order.findMany).not.toHaveBeenCalled();
  });

  it("not before 10 minutes of silence", async () => {
    await watchdog.tick(T0 + 10 * MIN);
    expect(silentAlerts()).toHaveLength(0);
  });

  it("after 10 minutes: one alert with the step label, alerted_step recorded; not repeated on the same step", async () => {
    await watchdog.tick(T0 + 10 * MIN + 1000);
    expect(silentAlerts()).toEqual([[
      1, 3, "WhatsApp driver hasn't replied for 10 min on order #1 (Going to pickup). Call the driver.", { kind: "whatsapp_driver_silent", step: "go_pickup", rider_id: 55 },
    ]]);
    expect(sessions[1].alerted_step).toBe("go_pickup");

    await watchdog.tick(T0 + 30 * MIN);
    expect(silentAlerts()).toHaveLength(1);
  });

  it("a new step alerts again once it is silent for 10 minutes", async () => {
    sessions[1].alerted_step = "go_pickup";
    steps[1] = { key: "go_stop", stopNumber: 2 };
    sessions[1].last_prompt_at = new Date(T0 + 5 * MIN);
    await watchdog.tick(T0 + 14 * MIN);
    expect(silentAlerts()).toHaveLength(0);
    await watchdog.tick(T0 + 16 * MIN);
    expect(silentAlerts()).toHaveLength(1);
    expect(silentAlerts()[0][2]).toContain("(Going to stop 2)");
    expect(sessions[1].alerted_step).toBe("go_stop:2");
  });

  it("silence counts from the latest of reply, prompt and session start", async () => {
    sessions[1] = { ...sessions[1], last_reply_at: null, last_prompt_at: null, created_at: new Date(T0) };
    await watchdog.tick(T0 + 9 * MIN);
    expect(silentAlerts()).toHaveLength(0);
    await watchdog.tick(T0 + 11 * MIN);
    expect(silentAlerts()).toHaveLength(1);
  });

  it("a fresh Live Location counts as activity only on driving steps", async () => {
    sessions[1].last_location_at = new Date(T0 + 8 * MIN);
    for (const key of ["go_pickup", "go_drop"]) {
      steps[1] = { key };
      await watchdog.tick(T0 + 12 * MIN);
    }
    steps[1] = { key: "go_stop", stopNumber: 1 };
    await watchdog.tick(T0 + 12 * MIN);
    expect(silentAlerts()).toHaveLength(0);
    await watchdog.tick(T0 + 18 * MIN + 1000); // location now 10 min old as well
    expect(silentAlerts()).toHaveLength(1);
  });

  it.each(["loading", "at_drop", "pickup_otp"])("Live Location does not count on %s", async (key) => {
    steps[1] = { key };
    sessions[1].last_location_at = new Date(T0 + 8 * MIN);
    await watchdog.tick(T0 + 12 * MIN);
    expect(silentAlerts()).toHaveLength(1);
  });

  it("alerted_step is written before the alert: a failed write raises no alert (no per-minute re-alert)", async () => {
    prisma.whatsapp_driver_session.updateMany.mockRejectedValue(new Error("db down"));
    await watchdog.tick(T0 + 11 * MIN);
    expect(silentAlerts()).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("no session (order card never sent) or a cancelled step: no silence alert", async () => {
    flow.loadContext.mockImplementationOnce(async (id) => ({ order: { id }, step: { key: "go_pickup" }, session: null }));
    await watchdog.tick(T0 + 60 * MIN);
    sessions[1] = { order_id: 1, rider_id: 55, last_reply_at: null, last_prompt_at: null, created_at: new Date(T0), alerted_step: null };
    steps[1] = { key: "cancelled" };
    await watchdog.tick(T0 + 60 * MIN);
    expect(silentAlerts()).toHaveLength(0);
  });

  it("one failing order does not stop the others; a failing tick never throws", async () => {
    sessions[9] = { order_id: 9, rider_id: 55 };
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 9, city_id: 3, rid: 55 }, { id: 1, city_id: 3, rid: 55 }]);
    flow.loadContext.mockImplementation(async (id) => {
      if (id === 9) throw new Error("boom");
      return ctx(id);
    });
    await watchdog.tick(T0 + 11 * MIN);
    expect(silentAlerts()).toHaveLength(1);
    expect(logger.error).toHaveBeenCalled();

    prisma.pkg_order.findMany.mockRejectedValue(new Error("db down"));
    await expect(watchdog.tick(T0 + 12 * MIN)).resolves.toBeUndefined();
  });

  it("an order now held by another driver (re-live / replace, driver_channel still 'whatsapp') is not watched", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 1, city_id: 3, rid: 99 }]);
    await watchdog.tick(T0 + 60 * MIN);
    expect(silentAlerts()).toHaveLength(0);
    expect(flow.loadContext).not.toHaveBeenCalled();
    client.getBotStatus.mockReturnValue({ status: "DISCONNECTED" });
    await watchdog.tick(T0 + 61 * MIN);
    expect(offlineAlerts()).toHaveLength(0);
  });

  it("overlapping ticks are skipped", async () => {
    let release;
    prisma.whatsapp_driver_session.findMany.mockImplementationOnce(() => new Promise((r) => { release = () => r([]); }));
    const first = watchdog.tick(T0);
    await watchdog.tick(T0);
    expect(prisma.whatsapp_driver_session.findMany).toHaveBeenCalledTimes(1);
    release();
    await first;
    await watchdog.tick(T0);
    expect(prisma.whatsapp_driver_session.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("bot offline alert", () => {
  it("one alert per active order per disconnect; again after a reconnect + new disconnect", async () => {
    client.getBotStatus.mockReturnValue({ status: "DISCONNECTED" });
    await watchdog.tick(T0);
    await watchdog.tick(T0 + MIN);
    expect(offlineAlerts()).toEqual([[1, 3, expect.stringContaining("order #1"), { kind: "whatsapp_bot_offline" }]]);

    client.getBotStatus.mockReturnValue({ status: "CONNECTED" });
    await watchdog.tick(T0 + 2 * MIN);
    expect(offlineAlerts()).toHaveLength(1);

    client.getBotStatus.mockReturnValue({ status: "AWAITING_QR_SCAN" });
    await watchdog.tick(T0 + 3 * MIN);
    expect(offlineAlerts()).toHaveLength(2);
  });

  it("while the bot is offline only the offline alert fires, no silence alert", async () => {
    client.getBotStatus.mockReturnValue({ status: "DISCONNECTED" });
    await watchdog.tick(T0 + 30 * MIN);
    expect(offlineAlerts()).toHaveLength(1);
    expect(silentAlerts()).toHaveLength(0);
    expect(flow.loadContext).not.toHaveBeenCalled();
  });

  it("no active WhatsApp order: no alert", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([]);
    client.getBotStatus.mockReturnValue({ status: "DISCONNECTED" });
    await watchdog.tick(T0);
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });
});

describe("start", () => {
  it("schedules an unref'd 60 s interval once", () => {
    jest.useFakeTimers();
    try {
      const spy = jest.spyOn(global, "setInterval");
      const t1 = watchdog.start();
      const t2 = watchdog.start();
      expect(t1).toBe(t2);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toBe(60 * 1000);
      watchdog.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
