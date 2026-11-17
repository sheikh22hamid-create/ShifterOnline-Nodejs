// WhatsApp Trial Order, Task 5: a trial driver's messages reach the order flow - never the customer menu, the AI or
// the chat-pause commands - and unknown senders keep the normal bot.
jest.mock("../../config/db", () => ({
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findFirst: jest.fn() },
  order_settlement: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("qrcode-terminal", () => ({ generate: jest.fn() }));
jest.mock("../groqService", () => ({}));
jest.mock("../sessionManager", () => ({ clearSession: jest.fn(), updateSession: jest.fn(), addHistory: jest.fn() }));
jest.mock("../chatControl", () => ({
  isStopCommand: jest.fn(() => true), isStartCommand: jest.fn(() => false), pauseChat: jest.fn(), resumeChat: jest.fn(),
  isChatPaused: jest.fn(() => false), getStopMessage: jest.fn(), getResumeMessage: jest.fn(), getAllPausedChats: jest.fn(),
}));
jest.mock("../handlers/customerHandler", () => ({}));
jest.mock("../handlers/driverHandler", () => ({}));
jest.mock("../notifications", () => ({ setWhatsAppClient: jest.fn() }));
jest.mock("../botMenuEngine", () => ({ processMenuMessage: jest.fn(), STEPS: {} }));
jest.mock("../driverOrder/flow", () => ({ handleDriverReply: jest.fn(), handleDriverLocation: jest.fn() }));

const prisma = require("../../config/db");
const chatControl = require("../chatControl");
const botMenuEngine = require("../botMenuEngine");
const flow = require("../driverOrder/flow");
const senderIdentity = require("../driverOrder/senderIdentity");
const { routeDriverMessage, routeLiveLocationUpdates } = require("../client");

const DRIVER_JID = "919876543210@s.whatsapp.net";

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  prisma.pkg_order.findFirst.mockResolvedValue(null);
  prisma.order_settlement.findMany.mockResolvedValue([]);
  flow.handleDriverReply.mockResolvedValue("step prompt");
  flow.handleDriverLocation.mockResolvedValue(undefined);
});

const fakeSock = () => ({ sendMessage: jest.fn().mockResolvedValue({}) });
const textMsg = (key = {}) => ({ key: { remoteJid: DRIVER_JID, id: "m1", ...key }, message: { conversation: "x" }, messageTimestamp: 1700000000 });

describe("senderIdentity.phoneFromMessage", () => {
  it("reads the 10-digit phone from a phone-number JID", () => {
    expect(senderIdentity.phoneFromMessage({ key: { remoteJid: "919876543210@s.whatsapp.net" } })).toBe("9876543210");
  });

  it("ignores a device suffix on the JID", () => {
    expect(senderIdentity.phoneFromMessage({ key: { remoteJid: "919876543210:12@s.whatsapp.net" } })).toBe("9876543210");
  });

  it("resolves an @lid sender through senderPn", () => {
    expect(senderIdentity.phoneFromMessage({ key: { remoteJid: "12345678901234@lid", senderPn: "919876543210@s.whatsapp.net" } }))
      .toBe("9876543210");
  });

  it("resolves an @lid sender through remoteJidAlt (Baileys 7 field)", () => {
    expect(senderIdentity.phoneFromMessage({ key: { remoteJid: "12345678901234@lid", remoteJidAlt: "919876543210@s.whatsapp.net" } }))
      .toBe("9876543210");
  });

  it("an @lid sender with no phone JID is unresolvable", () => {
    expect(senderIdentity.phoneFromMessage({ key: { remoteJid: "12345678901234@lid" } })).toBeNull();
    expect(senderIdentity.phoneFromMessage({ key: { remoteJid: "12345678901234@lid", remoteJidAlt: "999@lid" } })).toBeNull();
  });

  it("a non-Indian number or a missing key is unresolvable", () => {
    expect(senderIdentity.phoneFromMessage({ key: { remoteJid: "14155550123@s.whatsapp.net" } })).toBeNull();
    expect(senderIdentity.phoneFromMessage({})).toBeNull();
  });
});

describe("senderIdentity.findActiveWhatsAppOrder", () => {
  it("matches the rider by 10-digit and 91-prefixed fmobile, then the latest active WhatsApp order", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 55 }]);
    prisma.pkg_order.findFirst.mockResolvedValueOnce({ id: 877, rid: 55 });
    await expect(senderIdentity.findActiveWhatsAppOrder("9876543210")).resolves.toEqual({ orderId: 877, riderId: 55 });
    expect(prisma.tbl_rider.findMany.mock.calls[0][0].where.fmobile.in).toEqual(expect.arrayContaining(["9876543210", "919876543210"]));
    const where = prisma.pkg_order.findFirst.mock.calls[0][0].where;
    expect(where).toEqual(expect.objectContaining({
      rid: { in: [55] }, driver_channel: "whatsapp", order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] },
    }));
    expect(prisma.pkg_order.findFirst.mock.calls[0][0].orderBy).toEqual({ id: "desc" });
  });

  it("unknown phone -> null without looking for orders", async () => {
    await expect(senderIdentity.findActiveWhatsAppOrder("9876543210")).resolves.toBeNull();
    expect(prisma.pkg_order.findFirst).not.toHaveBeenCalled();
  });

  it("no active order -> a Completed WhatsApp order whose cash settlement is still pending (so PAISA MILA routes)", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 55 }]);
    prisma.order_settlement.findMany.mockResolvedValue([
      { order_id: 900, status: "pending", method: "online" },
      { order_id: 880, status: "pending", method: null },
    ]);
    prisma.pkg_order.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 880, rid: 55 });
    await expect(senderIdentity.findActiveWhatsAppOrder("9876543210")).resolves.toEqual({ orderId: 880, riderId: 55 });
    const where = prisma.pkg_order.findFirst.mock.calls[1][0].where;
    expect(where).toEqual(expect.objectContaining({ id: { in: [880] }, rid: { in: [55] }, driver_channel: "whatsapp", o_status: "Completed" }));
  });

  it("no active order and no pending cash -> null", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 55 }]);
    prisma.order_settlement.findMany.mockResolvedValue([{ order_id: 900, status: "pending", method: "online" }]);
    await expect(senderIdentity.findActiveWhatsAppOrder("9876543210")).resolves.toBeNull();
    expect(prisma.pkg_order.findFirst).toHaveBeenCalledTimes(1);
  });

  it("a malformed phone -> null", async () => {
    await expect(senderIdentity.findActiveWhatsAppOrder("12345")).resolves.toBeNull();
    expect(prisma.tbl_rider.findMany).not.toHaveBeenCalled();
  });
});

describe("routeDriverMessage", () => {
  const withActiveOrder = () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 55 }]);
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 877, rid: 55 });
  };

  it('a driver with an active WhatsApp order sending "stop" goes to the order flow, never pauses the chat', async () => {
    withActiveOrder();
    const sock = fakeSock();
    await expect(routeDriverMessage({ msg: textMsg(), text: "stop", sock })).resolves.toBe(true);
    expect(flow.handleDriverReply).toHaveBeenCalledWith({ orderId: 877, riderId: 55, text: "stop" });
    expect(sock.sendMessage).toHaveBeenCalledWith(DRIVER_JID, { text: "step prompt" });
    expect(chatControl.pauseChat).not.toHaveBeenCalled();
    expect(botMenuEngine.processMenuMessage).not.toHaveBeenCalled();
  });

  it("an @lid driver is matched through remoteJidAlt and answered on the @lid chat", async () => {
    withActiveOrder();
    const sock = fakeSock();
    const msg = textMsg({ remoteJid: "12345678901234@lid", remoteJidAlt: DRIVER_JID });
    await expect(routeDriverMessage({ msg, text: "1", sock })).resolves.toBe(true);
    expect(prisma.tbl_rider.findMany.mock.calls[0][0].where.fmobile.in).toContain("9876543210");
    expect(sock.sendMessage).toHaveBeenCalledWith("12345678901234@lid", { text: "step prompt" });
  });

  it("unknown sender -> false (normal bot handles it)", async () => {
    const sock = fakeSock();
    await expect(routeDriverMessage({ msg: textMsg(), text: "hi", sock })).resolves.toBe(false);
    expect(flow.handleDriverReply).not.toHaveBeenCalled();
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it("unresolvable @lid sender -> false", async () => {
    const sock = fakeSock();
    await expect(routeDriverMessage({ msg: textMsg({ remoteJid: "1@lid" }), text: "hi", sock })).resolves.toBe(false);
    expect(prisma.tbl_rider.findMany).not.toHaveBeenCalled();
  });

  it("a lookup failure falls back to the normal bot instead of dropping the message", async () => {
    prisma.tbl_rider.findMany.mockRejectedValue(new Error("db down"));
    await expect(routeDriverMessage({ msg: textMsg(), text: "hi", sock: fakeSock() })).resolves.toBe(false);
  });

  it("LOCATION_PIN text -> handleDriverLocation with numbers, no reply", async () => {
    withActiveOrder();
    const sock = fakeSock();
    const msg = { key: { remoteJid: DRIVER_JID, id: "m2" }, message: { locationMessage: { degreesLatitude: 22.7, degreesLongitude: 75.8 } }, messageTimestamp: 1700000000 };
    await expect(routeDriverMessage({ msg, text: "LOCATION_PIN:22.7,75.8", sock })).resolves.toBe(true);
    expect(flow.handleDriverLocation).toHaveBeenCalledWith({ orderId: 877, riderId: 55, lat: 22.7, lng: 75.8, timestampMs: 1700000000000 });
    expect(flow.handleDriverReply).not.toHaveBeenCalled();
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it("a named pin keeps the coordinates; a Live Location update is stamped with its arrival time", async () => {
    withActiveOrder();
    const now = Date.now();
    const msg = { key: { remoteJid: DRIVER_JID, id: "m3" }, message: { liveLocationMessage: { degreesLatitude: 22.71, degreesLongitude: 75.81 } }, messageTimestamp: 1600000000 };
    await routeDriverMessage({ msg, text: "LOCATION_PIN:22.71,75.81:On my way, almost", sock: fakeSock() });
    const args = flow.handleDriverLocation.mock.calls[0][0];
    expect(args).toEqual(expect.objectContaining({ lat: 22.71, lng: 75.81 }));
    expect(args.timestampMs).toBeGreaterThanOrEqual(now);
  });

  it("a driver's message with no text (sticker, reaction) is swallowed: no reply, no menu", async () => {
    withActiveOrder();
    const sock = fakeSock();
    await expect(routeDriverMessage({ msg: textMsg(), text: "", sock })).resolves.toBe(true);
    expect(flow.handleDriverReply).not.toHaveBeenCalled();
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it("an unexpected flow error still answers the driver with the helpline, never the menu", async () => {
    withActiveOrder();
    flow.handleDriverReply.mockRejectedValue(new Error("db down"));
    const sock = fakeSock();
    await expect(routeDriverMessage({ msg: textMsg(), text: "1", sock })).resolves.toBe(true);
    expect(sock.sendMessage.mock.calls[0][1].text).toContain("9109114515");
  });
});

describe("routeLiveLocationUpdates (Live Location delivered as messages.update)", () => {
  it("routes a live-location update of a trial driver to handleDriverLocation", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 55 }]);
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 877, rid: 55 });
    await routeLiveLocationUpdates([
      { key: { remoteJid: DRIVER_JID, id: "m4" }, update: { message: { editedMessage: { message: { liveLocationMessage: { degreesLatitude: 22.8, degreesLongitude: 75.9 } } } } } },
      { key: { remoteJid: DRIVER_JID, id: "m5" }, update: { status: 3 } },
      { key: { remoteJid: DRIVER_JID, id: "m6", fromMe: true }, update: { message: { liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 1 } } } },
    ], fakeSock());
    expect(flow.handleDriverLocation).toHaveBeenCalledTimes(1);
    expect(flow.handleDriverLocation).toHaveBeenCalledWith(expect.objectContaining({ orderId: 877, riderId: 55, lat: 22.8, lng: 75.9 }));
  });
});
