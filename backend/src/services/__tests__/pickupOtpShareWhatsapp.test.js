jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findFirst: jest.fn() },
  driver_trip_progress: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  whatsapp_driver_session: { findUnique: jest.fn() },
  pickup_otp_share: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../utils/pickupOtpTimeout", () => ({ getPickupOtpTimeoutMinutes: jest.fn().mockResolvedValue(10) }));
jest.mock("../dispatchManager", () => ({ emitDriverEvent: jest.fn() }));
jest.mock("../../whatsapp/notifications", () => ({ sendWhatsAppNotification: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const notifications = require("../../whatsapp/notifications");
const messages = require("../../whatsapp/driverOrder/messages");
const service = require("../pickupOtpShareService");

const NOW = Date.now();
const ORDER = { id: 100, uid: 3, rid: 7, order_status: 2, o_status: "Pickup", otp: 4821, driver_channel: "whatsapp" };
const TIMER = { pickup_wait_start: new Date(NOW - 2 * 60000), pickup_wait_end: null, pickup_wait_banked_seconds: 0 };

beforeEach(() => {
  jest.resetAllMocks();
  require("../../utils/pickupOtpTimeout").getPickupOtpTimeoutMinutes.mockResolvedValue(10);
  prisma.pkg_order.findUnique.mockResolvedValue(ORDER);
  prisma.pkg_order_wait_timer.findFirst.mockResolvedValue(TIMER);
  prisma.driver_trip_progress.findUnique.mockResolvedValue(null);
  prisma.tbl_rider.findUnique.mockResolvedValue({ id: 7, fmobile: "9876543210" });
  prisma.pickup_otp_share.findFirst.mockResolvedValue(null);
  prisma.pickup_otp_share.create.mockImplementation(async ({ data }) => ({ id: 55, status: "pending", attempts: 1, ...data }));
  prisma.pickup_otp_share.updateMany.mockResolvedValue({ count: 1 });
  prisma.pickup_otp_share.update.mockResolvedValue({ id: 55 });
  prisma.whatsapp_driver_session.findUnique.mockResolvedValue({ rider_id: 7 });
});

describe("share on a WhatsApp-channel order", () => {
  it("sends the OTP to the driver's WhatsApp and marks the row delivered, without the app socket nudge", async () => {
    notifications.sendWhatsAppNotification.mockResolvedValue(true);
    expect(await service.share({ uid: 3, orderId: 100 })).toEqual({ ok: true, msg: service.MSG.SENT });
    expect(notifications.sendWhatsAppNotification).toHaveBeenCalledWith("9876543210", messages.pickupOtpShared(4821));
    expect(prisma.pickup_otp_share.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 55 }, data: expect.objectContaining({ status: "delivered", delivered_at: expect.any(Date) }) })
    );
    expect(dispatchManager.emitDriverEvent).not.toHaveBeenCalled();
  });

  it("marks the row failed and answers FAILED when the send fails", async () => {
    notifications.sendWhatsAppNotification.mockResolvedValue(false);
    expect(await service.share({ uid: 3, orderId: 100 })).toEqual({ ok: false, msg: service.MSG.FAILED });
    expect(prisma.pickup_otp_share.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 55 }, data: { status: "failed" } })
    );
    expect(dispatchManager.emitDriverEvent).not.toHaveBeenCalled();
  });

  it("treats a thrown send or a missing driver phone as failed", async () => {
    notifications.sendWhatsAppNotification.mockRejectedValue(new Error("boom"));
    expect((await service.share({ uid: 3, orderId: 100 })).ok).toBe(false);
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 7, fmobile: null });
    notifications.sendWhatsAppNotification.mockClear();
    expect((await service.share({ uid: 3, orderId: 100 })).ok).toBe(false);
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("keeps the app path for app-channel orders", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, driver_channel: "app" });
    prisma.pickup_otp_share.findUnique.mockResolvedValue({ id: 55, status: "delivered" });
    expect(await service.share({ uid: 3, orderId: 100 })).toEqual({ ok: true, msg: service.MSG.SENT });
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalled();
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("a re-lived order now held by an app driver uses the app path, though driver_channel still says 'whatsapp'", async () => {
    // The session belongs to the old WhatsApp driver (rider 6); app driver 7 holds the order now.
    prisma.whatsapp_driver_session.findUnique.mockResolvedValue({ rider_id: 6 });
    prisma.pickup_otp_share.findUnique.mockResolvedValue({ id: 55, status: "delivered" });
    expect(await service.share({ uid: 3, orderId: 100 })).toEqual({ ok: true, msg: service.MSG.SENT });
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(7, "pickup_otp:shared", { order_id: 100, share_id: 55 });
    expect(notifications.sendWhatsAppNotification).not.toHaveBeenCalled();
  });
});
