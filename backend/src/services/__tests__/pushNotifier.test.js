jest.mock("../../config/firebase", () => ({ sendPushNotification: jest.fn().mockResolvedValue({ sent: true }) }));

const { sendPushNotification } = require("../../config/firebase");
const pushNotifier = require("../pushNotifier");

describe("pushNotifier", () => {
  beforeEach(() => jest.clearAllMocks());

  it("notifyDriverOrderRequest sends the order payload as string-valued FCM data", async () => {
    await pushNotifier.notifyDriverOrderRequest("tok-1", {
      order_id: "42",
      pickup_address: "A",
      delivery_address: "B",
    });

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-1",
      "New Order Request",
      expect.any(String),
      expect.objectContaining({ order_id: "42", type: "order" })
    );
  });

  it("notifyDriverDismiss sends a dismiss payload with the reason", async () => {
    await pushNotifier.notifyDriverDismiss("tok-2", 42, "timeout");

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-2",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ type: "order_dismiss", order_id: "42", reason: "timeout" })
    );
  });

  it("notifyCustomerOrderAssigned sends the assigned rider's info", async () => {
    await pushNotifier.notifyCustomerOrderAssigned("tok-3", { order_id: 42, rider_name: "Deepak", otp: 1234 });

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-3",
      "Order Assigned!",
      expect.stringContaining("Deepak"),
      expect.objectContaining({ type: "order_assigned", otp: "1234" })
    );
  });

  it("notifyCustomerNoDriverFound sends a no-driver payload", async () => {
    await pushNotifier.notifyCustomerNoDriverFound("tok-4", 42);

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-4",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ type: "no_driver_found", order_id: "42" })
    );
  });

  it("passes through a falsy fcmToken without throwing", async () => {
    await expect(pushNotifier.notifyDriverOrderRequest(null, { order_id: "1" })).resolves.toBeDefined();
  });
});
