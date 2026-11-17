// WhatsApp Trial Order, Task 5: a trial driver's messages reach the order flow - never the customer menu, the AI or
// the chat-pause commands - and unknown senders keep the normal bot.
jest.mock("../../config/db", () => ({
  whatsapp_driver_session: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
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
  prisma.whatsapp_driver_session.findMany.mockResolvedValue([]);
  prisma.pkg_order.findMany.mockResolvedValue([]);
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
  const HOUR = 60 * 60 * 1000;
  const session = (order_id, rider_id = 55, ageMs = HOUR) => ({ order_id, rider_id, phone: "9876543210", updated_at: new Date(Date.now() - ageMs) });
  const seedSessions = (sessions, orders, settlements = []) => {
    prisma.whatsapp_driver_session.findMany.mockResolvedValue(sessions);
    prisma.pkg_order.findMany.mockResolvedValue(orders);
    prisma.order_settlement.findMany.mockResolvedValue(settlements);
  };
  const find = () => senderIdentity.findActiveWhatsAppOrder("9876543210");

  it("looks up sessions by phone updated within 24 h, latest first, and returns the active order", async () => {
    seedSessions([session(877)], [{ id: 877, rid: 55, order_status: 2, o_status: "Pickup" }]);
    await expect(find()).resolves.toEqual({ orderId: 877, riderId: 55 });
    const args = prisma.whatsapp_driver_session.findMany.mock.calls[0][0];
    expect(args.where.phone).toBe("9876543210");
    expect(Date.now() - args.where.updated_at.gte.getTime()).toBeGreaterThanOrEqual(24 * HOUR - 1000);
    expect(Date.now() - args.where.updated_at.gte.getTime()).toBeLessThanOrEqual(24 * HOUR + 1000);
    expect(args.orderBy).toEqual({ updated_at: "desc" });
  });

  it("unknown phone -> null, no rider scan and no order lookup", async () => {
    await expect(find()).resolves.toBeNull();
    expect(prisma.tbl_rider.findMany).not.toHaveBeenCalled();
    expect(prisma.pkg_order.findMany).not.toHaveBeenCalled();
  });

  it("a session older than 24 h is not returned by the query -> null", async () => {
    // The 24 h window is in the query; a cancelled order whose session is older simply isn't found.
    seedSessions([], [{ id: 877, rid: 0, order_status: 0, o_status: "Cancelled" }]);
    await expect(find()).resolves.toBeNull();
  });

  it("a Completed order with pending cash routes (so PAISA MILA works); a settled one does not", async () => {
    seedSessions([session(880)], [{ id: 880, rid: 55, order_status: 4, o_status: "Completed" }],
      [{ order_id: 880, status: "pending", method: null }]);
    await expect(find()).resolves.toEqual({ orderId: 880, riderId: 55 });
    seedSessions([session(880)], [{ id: 880, rid: 55, order_status: 4, o_status: "Completed" }],
      [{ order_id: 880, status: "pending", method: "online" }]);
    await expect(find()).resolves.toBeNull();
  });

  it("a cancelled order within 24 h routes to the flow (it answers 'order cancel ho gaya')", async () => {
    seedSessions([session(877)], [{ id: 877, rid: 55, order_status: 5, o_status: "Cancelled" }]);
    await expect(find()).resolves.toEqual({ orderId: 877, riderId: 55 });
  });

  it("a re-lived / reassigned order (rid no longer this driver) routes with the session's rider", async () => {
    seedSessions([session(877)], [{ id: 877, rid: 0, order_status: 0, o_status: "Pending" }]);
    await expect(find()).resolves.toEqual({ orderId: 877, riderId: 55 });
  });

  it("priority: active beats pending cash beats cancelled, whatever the session order", async () => {
    seedSessions([session(3, 55, HOUR), session(2, 55, 2 * HOUR), session(1, 55, 3 * HOUR)], [
      { id: 3, rid: 55, order_status: 5, o_status: "Cancelled" },
      { id: 2, rid: 55, order_status: 4, o_status: "Completed" },
      { id: 1, rid: 55, order_status: 1, o_status: "Processing" },
    ], [{ order_id: 2, status: "pending", method: null }]);
    await expect(find()).resolves.toEqual({ orderId: 1, riderId: 55 });

    seedSessions([session(3, 55, HOUR), session(2, 55, 2 * HOUR)], [
      { id: 3, rid: 55, order_status: 5, o_status: "Cancelled" },
      { id: 2, rid: 55, order_status: 4, o_status: "Completed" },
    ], [{ order_id: 2, status: "pending", method: null }]);
    await expect(find()).resolves.toEqual({ orderId: 2, riderId: 55 });
  });

  it("an active order assigned to the session's driver wins over an active one reassigned away", async () => {
    seedSessions([session(9, 55, HOUR), session(8, 55, 2 * HOUR)], [
      { id: 9, rid: 77, order_status: 2, o_status: "Pickup" },
      { id: 8, rid: 55, order_status: 3, o_status: "Ongoing" },
    ]);
    await expect(find()).resolves.toEqual({ orderId: 8, riderId: 55 });
  });

  it("a malformed phone -> null", async () => {
    await expect(senderIdentity.findActiveWhatsAppOrder("12345")).resolves.toBeNull();
    expect(prisma.whatsapp_driver_session.findMany).not.toHaveBeenCalled();
  });
});

describe("routeDriverMessage", () => {
  const withActiveOrder = () => {
    prisma.whatsapp_driver_session.findMany.mockResolvedValue([{ order_id: 877, rider_id: 55, phone: "9876543210", updated_at: new Date() }]);
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 877, rid: 55, order_status: 2, o_status: "Pickup" }]);
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
    expect(prisma.whatsapp_driver_session.findMany.mock.calls[0][0].where.phone).toBe("9876543210");
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
    expect(prisma.whatsapp_driver_session.findMany).not.toHaveBeenCalled();
  });

  it("a lookup failure falls back to the normal bot instead of dropping the message", async () => {
    prisma.whatsapp_driver_session.findMany.mockRejectedValue(new Error("db down"));
    await expect(routeDriverMessage({ msg: textMsg(), text: "hi", sock: fakeSock() })).resolves.toBe(false);
  });

  describe("location security", () => {
    let shareSeq = 0;
    const nowSec = () => Math.floor(Date.now() / 1000);
    // Each test gets its own share id, so the per-rider "newest update" memory never leaks between tests.
    const liveMsg = ({ seq = 1, ts = nowSec(), id = `share-${++shareSeq}`, extra = {} } = {}) => ({
      key: { remoteJid: DRIVER_JID, id },
      message: { liveLocationMessage: { degreesLatitude: 22.71, degreesLongitude: 75.81, sequenceNumber: seq, ...extra } },
      messageTimestamp: ts,
    });

    it("typed 'LOCATION_PIN:...' text is ordinary reply text - never a location", async () => {
      withActiveOrder();
      const sock = fakeSock();
      const msg = { key: { remoteJid: DRIVER_JID, id: "t1" }, message: { conversation: "LOCATION_PIN:22.7,75.8" }, messageTimestamp: nowSec() };
      await expect(routeDriverMessage({ msg, text: "LOCATION_PIN:22.7,75.8", sock })).resolves.toBe(true);
      expect(flow.handleDriverLocation).not.toHaveBeenCalled();
      expect(flow.handleDriverReply).toHaveBeenCalledWith({ orderId: 877, riderId: 55, text: "LOCATION_PIN:22.7,75.8" });
      expect(sock.sendMessage).toHaveBeenCalledWith(DRIVER_JID, { text: "step prompt" });
    });

    it("a static map pin has no location effect and gets no reply", async () => {
      withActiveOrder();
      const sock = fakeSock();
      const msg = { key: { remoteJid: DRIVER_JID, id: "p1" }, message: { locationMessage: { degreesLatitude: 22.7, degreesLongitude: 75.8 } }, messageTimestamp: nowSec() };
      await expect(routeDriverMessage({ msg, text: "LOCATION_PIN:22.7,75.8", sock })).resolves.toBe(true);
      expect(flow.handleDriverLocation).not.toHaveBeenCalled();
      expect(flow.handleDriverReply).not.toHaveBeenCalled();
      expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    it("a forwarded Live Location or forwarded text has no effect and gets no reply", async () => {
      withActiveOrder();
      const sock = fakeSock();
      const fwdLive = liveMsg({ extra: { contextInfo: { isForwarded: true } } });
      await expect(routeDriverMessage({ msg: fwdLive, text: "LOCATION_PIN:22.71,75.81", sock })).resolves.toBe(true);
      const fwdText = { key: { remoteJid: DRIVER_JID, id: "f2" }, message: { extendedTextMessage: { text: "1", contextInfo: { isForwarded: true } } }, messageTimestamp: nowSec() };
      await expect(routeDriverMessage({ msg: fwdText, text: "1", sock })).resolves.toBe(true);
      expect(flow.handleDriverLocation).not.toHaveBeenCalled();
      expect(flow.handleDriverReply).not.toHaveBeenCalled();
      expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    it("a real-time Live Location update takes coordinates from the GPS share (not the text) and is stamped on arrival", async () => {
      withActiveOrder();
      const sock = fakeSock();
      const before = Date.now();
      await routeDriverMessage({ msg: liveMsg({ ts: nowSec() - 60 }), text: "LOCATION_PIN:1,1", sock });
      const args = flow.handleDriverLocation.mock.calls[0][0];
      expect(args).toEqual(expect.objectContaining({ orderId: 877, riderId: 55, lat: 22.71, lng: 75.81 }));
      expect(args.timestampMs).toBeGreaterThanOrEqual(before);
      expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    it("only a higher sequenceNumber of the same share gets the arrival time; a repeat keeps its real timestamp", async () => {
      withActiveOrder();
      const id = "share-seq";
      const ts = nowSec() - 30;
      await routeDriverMessage({ msg: liveMsg({ id, seq: 5, ts }), text: "", sock: fakeSock() });
      await routeDriverMessage({ msg: liveMsg({ id, seq: 5, ts }), text: "", sock: fakeSock() });
      await routeDriverMessage({ msg: liveMsg({ id, seq: 4, ts }), text: "", sock: fakeSock() });
      await routeDriverMessage({ msg: liveMsg({ id, seq: 6, ts }), text: "", sock: fakeSock() });
      const stamps = flow.handleDriverLocation.mock.calls.map((c) => c[0].timestampMs);
      expect(stamps[0]).toBeGreaterThan(ts * 1000 + 1000);
      expect(stamps[1]).toBe(ts * 1000);
      expect(stamps[2]).toBe(ts * 1000);
      expect(stamps[3]).toBeGreaterThan(ts * 1000 + 1000);
    });

    it("an offline/append update keeps its real messageTimestamp (chosen over dropping: leg-start guards apply)", async () => {
      withActiveOrder();
      const ts = nowSec() - 20;
      await routeDriverMessage({ msg: liveMsg({ ts }), text: "", sock: fakeSock(), realtime: false });
      expect(flow.handleDriverLocation.mock.calls[0][0].timestampMs).toBe(ts * 1000);
    });

    it("a real-time update 10 min after the share started, with a higher sequence, is stamped on arrival", async () => {
      withActiveOrder();
      const id = "share-long";
      const started = nowSec() - 600;
      await routeDriverMessage({ msg: liveMsg({ id, seq: 1, ts: started }), text: "", sock: fakeSock() });
      const before = Date.now();
      await routeDriverMessage({ msg: liveMsg({ id, seq: 40, ts: started }), text: "", sock: fakeSock() });
      expect(flow.handleDriverLocation.mock.calls[1][0].timestampMs).toBeGreaterThanOrEqual(before);
    });

    it("a repeated sequence of a 10-min-old share keeps its real timestamp", async () => {
      withActiveOrder();
      const id = "share-long-repeat";
      const started = nowSec() - 600;
      await routeDriverMessage({ msg: liveMsg({ id, seq: 40, ts: started }), text: "", sock: fakeSock() });
      await routeDriverMessage({ msg: liveMsg({ id, seq: 40, ts: started }), text: "", sock: fakeSock() });
      expect(flow.handleDriverLocation.mock.calls[1][0].timestampMs).toBe(started * 1000);
    });

    it("a real-time update with no sequenceNumber keeps its real timestamp", async () => {
      withActiveOrder();
      const ts = nowSec() - 30;
      await routeDriverMessage({ msg: liveMsg({ seq: null, ts }), text: "", sock: fakeSock() });
      expect(flow.handleDriverLocation.mock.calls[0][0].timestampMs).toBe(ts * 1000);
    });

    it("an update with no usable time (no messageTimestamp, not eligible for arrival time) is dropped", async () => {
      withActiveOrder();
      await routeDriverMessage({ msg: liveMsg({ ts: null }), text: "", sock: fakeSock(), realtime: false });
      expect(flow.handleDriverLocation).not.toHaveBeenCalled();
    });

    it("a protobuf Long sequenceNumber is read", async () => {
      withActiveOrder();
      const before = Date.now();
      await routeDriverMessage({ msg: liveMsg({ seq: { low: 7, high: 0 } }), text: "", sock: fakeSock() });
      expect(flow.handleDriverLocation.mock.calls[0][0].timestampMs).toBeGreaterThanOrEqual(before);
    });
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
    prisma.whatsapp_driver_session.findMany.mockResolvedValue([{ order_id: 877, rider_id: 55, phone: "9876543210", updated_at: new Date() }]);
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 877, rid: 55, order_status: 2, o_status: "Pickup" }]);
    await routeLiveLocationUpdates([
      { key: { remoteJid: DRIVER_JID, id: "m4" }, update: { messageTimestamp: Math.floor(Date.now() / 1000), message: { editedMessage: { message: { liveLocationMessage: { degreesLatitude: 22.8, degreesLongitude: 75.9, sequenceNumber: 3 } } } } } },
      { key: { remoteJid: DRIVER_JID, id: "m5" }, update: { status: 3 } },
      { key: { remoteJid: DRIVER_JID, id: "m6", fromMe: true }, update: { message: { liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 1 } } } },
    ], fakeSock());
    expect(flow.handleDriverLocation).toHaveBeenCalledTimes(1);
    expect(flow.handleDriverLocation).toHaveBeenCalledWith(expect.objectContaining({ orderId: 877, riderId: 55, lat: 22.8, lng: 75.9 }));
  });
});
