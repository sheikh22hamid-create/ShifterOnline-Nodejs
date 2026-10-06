// Editing the drop contact in the admin panel must keep the receiver-pays pay-link recipient in step.
jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn(), update: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/walletPrepaymentRefund", () => ({}));
jest.mock("../../services/referralPointsRefund", () => ({}));
jest.mock("../../services/dispatchManager", () => ({}));
jest.mock("../../services/pricingEngine", () => ({}));
jest.mock("../../services/pushNotifier", () => ({}));
jest.mock("../../sockets/adminSocket", () => ({ notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));
jest.mock("../../services/receiverTrackMessage", () => ({ syncReceiverPhone: jest.fn().mockResolvedValue({ rotated: false }) }));
jest.mock("../../services/receiverPayService", () => {
  class ReceiverPayError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  return { ReceiverPayError, changeReceiverPhone: jest.fn() };
});

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const receiverPayService = require("../../services/receiverPayService");
const trackMsg = require("../../services/receiverTrackMessage");
const { update } = require("../adminOrderController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const req = (body) => ({ params: { id: "50" }, body, user: { id: 1, role: "superadmin" } });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, city_id: 1, o_status: "Processing" });
  prisma.pkg_order.update.mockResolvedValue({ id: 50 });
  receiverPayService.changeReceiverPhone.mockResolvedValue({ changed: true });
});

describe("adminOrderController.update - dmobile sync", () => {
  it("passes a changed dmobile to the receiver-pays service", async () => {
    const r = res();
    await update(req({ dmobile: "98765 43210" }), r);
    expect(receiverPayService.changeReceiverPhone).toHaveBeenCalledWith({ orderId: 50, phone: "98765 43210" });
    expect(r.status).toHaveBeenCalledWith(200);
  });
  it("does nothing for other edits", async () => {
    await update(req({ paddress: "x" }), res());
    expect(receiverPayService.changeReceiverPhone).not.toHaveBeenCalled();
  });
  it("a receiver-pays refusal (not active, bad number) never fails the edit and is not logged as an error", async () => {
    receiverPayService.changeReceiverPhone.mockRejectedValue(new receiverPayService.ReceiverPayError("NOT_ACTIVE", "nope"));
    const r = res();
    await update(req({ dmobile: "98765 43210" }), r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(logger.error).not.toHaveBeenCalled();
  });
  it("an unexpected error is logged but the edit still succeeds", async () => {
    receiverPayService.changeReceiverPhone.mockRejectedValue(new Error("db down"));
    const r = res();
    await update(req({ dmobile: "98765 43210" }), r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("adminOrderController.update - tracking link", () => {
  it("rotates the tracking link even when the order has no receiver-pays row", async () => {
    receiverPayService.changeReceiverPhone.mockRejectedValue(new receiverPayService.ReceiverPayError("NOT_ACTIVE", "nope"));
    await update(req({ dmobile: "98765 43210" }), res());
    expect(trackMsg.syncReceiverPhone).toHaveBeenCalledWith(50, "98765 43210");
  });
  it("is not touched by other edits", async () => {
    await update(req({ paddress: "x" }), res());
    expect(trackMsg.syncReceiverPhone).not.toHaveBeenCalled();
  });
});
