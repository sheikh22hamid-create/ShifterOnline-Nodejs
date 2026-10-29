jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../services/pickupOtpShareService", () => ({
  share: jest.fn(), pendingForDriver: jest.fn(), acknowledge: jest.fn(),
  MSG: { FAILED: "Unable to send OTP to driver. Please try again." },
}));

const service = require("../../services/pickupOtpShareService");
const controller = require("../pickupOtpShareController");

const call = async (handler, body) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ body }, res);
  return res.json.mock.calls[0][0];
};

beforeEach(() => jest.resetAllMocks());

describe("customerShare", () => {
  it("passes the service's exact message through for success and for refusals", async () => {
    service.share.mockResolvedValueOnce({ ok: true, msg: "OTP sent to driver successfully." }).mockResolvedValueOnce({ ok: false, msg: "Pickup OTP has already been verified." });
    expect(await call(controller.customerShare, { uid: 3, order_id: 100 })).toEqual({ ResponseCode: "200", Result: "true", ResponseMsg: "OTP sent to driver successfully." });
    expect(service.share).toHaveBeenCalledWith({ uid: 3, orderId: 100 });
    expect(await call(controller.customerShare, { uid: 3, order_id: 100 })).toEqual({ ResponseCode: "400", Result: "false", ResponseMsg: "Pickup OTP has already been verified." });
  });
  it("an unexpected error is the plain failure message, never a success", async () => {
    service.share.mockRejectedValue(new Error("db"));
    expect(await call(controller.customerShare, { uid: 3, order_id: 100 })).toEqual({ ResponseCode: "500", Result: "false", ResponseMsg: "Unable to send OTP to driver. Please try again." });
  });
});

describe("driver endpoints", () => {
  it("pending returns the share, or an empty answer", async () => {
    service.pendingForDriver.mockResolvedValueOnce({ share_id: 5, order_id: 100, otp: "4321", delivered: false }).mockResolvedValueOnce(null);
    expect(await call(controller.driverPending, { rider_id: 7, order_id: 100 })).toEqual({ Result: true, share_id: 5, order_id: 100, otp: "4321", delivered: false });
    expect(service.pendingForDriver).toHaveBeenCalledWith({ riderId: 7, orderId: 100 });
    expect(await call(controller.driverPending, { rider_id: 7, order_id: 100 })).toEqual({ Result: true, share_id: null });
  });
  it("ack passes the service's verdict", async () => {
    service.acknowledge.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await call(controller.driverAck, { rider_id: 7, order_id: 100, share_id: 5 })).toEqual({ Result: true });
    expect(service.acknowledge).toHaveBeenCalledWith({ riderId: 7, orderId: 100, shareId: 5 });
    expect(await call(controller.driverAck, { rider_id: 8, order_id: 100, share_id: 5 })).toEqual({ Result: false });
  });
});
