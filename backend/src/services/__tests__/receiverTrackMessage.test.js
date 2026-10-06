jest.mock("../../config/db", () => ({
  order_track_link: { findUnique: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../receiverTrackSettings", () => ({ isTrackingEnabled: jest.fn() }));
jest.mock("../trackLinkService", () => ({ getOrCreate: jest.fn(), buildLink: jest.fn() }));
jest.mock("../../whatsapp/notifications", () => ({ sendWhatsAppNotification: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../receiverTrackSettings");
const links = require("../trackLinkService");
const { sendWhatsAppNotification } = require("../../whatsapp/notifications");
const { trackLine, syncReceiverPhone } = require("../receiverTrackMessage");

beforeEach(() => {
  jest.clearAllMocks();
  settings.isTrackingEnabled.mockResolvedValue(true);
  links.getOrCreate.mockResolvedValue({ token: "tok" });
  links.buildLink.mockReturnValue("https://api.example.com/track/tok");
  sendWhatsAppNotification.mockResolvedValue(true);
});

describe("trackLine", () => {
  it("returns the link line when the driver is assigned and tracking is on", async () => {
    expect(await trackLine({ id: 50, rid: 9 }, "9876543210")).toBe("📍 *Live track karein*: https://api.example.com/track/tok\n\n");
    expect(links.getOrCreate).toHaveBeenCalledWith(50, "9876543210");
  });
  it("is empty without a receiver phone or before a driver is assigned", async () => {
    expect(await trackLine({ id: 50, rid: 9 }, "")).toBe("");
    expect(await trackLine({ id: 50, rid: 0 }, "9876543210")).toBe("");
    expect(links.getOrCreate).not.toHaveBeenCalled();
  });
  it("is empty when tracking is off or the link cannot be built", async () => {
    settings.isTrackingEnabled.mockResolvedValue(false);
    expect(await trackLine({ id: 50, rid: 9 }, "9876543210")).toBe("");
    settings.isTrackingEnabled.mockResolvedValue(true);
    links.buildLink.mockReturnValue(null);
    expect(await trackLine({ id: 50, rid: 9 }, "9876543210")).toBe("");
  });
  it("is empty (never throws) when anything fails", async () => {
    links.getOrCreate.mockRejectedValue(new Error("db"));
    expect(await trackLine({ id: 50, rid: 9 }, "9876543210")).toBe("");
  });
});

describe("syncReceiverPhone", () => {
  it("does nothing when the order has no link yet (it is created at assignment with the then-current number)", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(null);
    expect(await syncReceiverPhone(50, "9000000000")).toEqual({ rotated: false });
    expect(links.getOrCreate).not.toHaveBeenCalled();
  });
  it("does nothing when the number did not change", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue({ receiver_phone: "9000000000" });
    expect(await syncReceiverPhone(50, "+91 90000 00000")).toEqual({ rotated: false });
    expect(links.getOrCreate).not.toHaveBeenCalled();
  });
  it("rotates the link and sends the new one to the new number while the delivery is in progress", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue({ receiver_phone: "9876543210" });
    prisma.pkg_order.findUnique.mockResolvedValue({ rid: 9, order_status: 3 });
    expect(await syncReceiverPhone(50, "9000000000")).toEqual({ rotated: true });
    expect(links.getOrCreate).toHaveBeenCalledWith(50, "9000000000");
    expect(sendWhatsAppNotification).toHaveBeenCalledWith("9000000000", expect.stringContaining("https://api.example.com/track/tok"));
  });
  it.each([[0, 0], [9, 5], [9, 4]])("rotates but sends nothing when rid=%p order_status=%p", async (rid, order_status) => {
    prisma.order_track_link.findUnique.mockResolvedValue({ receiver_phone: "9876543210" });
    prisma.pkg_order.findUnique.mockResolvedValue({ rid, order_status });
    expect(await syncReceiverPhone(50, "9000000000")).toEqual({ rotated: true });
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });
  it("never throws", async () => {
    prisma.order_track_link.findUnique.mockRejectedValue(new Error("db"));
    expect(await syncReceiverPhone(50, "9000000000")).toEqual({ rotated: false });
  });
});
