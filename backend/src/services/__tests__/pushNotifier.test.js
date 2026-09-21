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

  it("notifyDriverDismiss sends a real (non-data-only) dismiss notification on the driver app's own channel", async () => {
    await pushNotifier.notifyDriverDismiss("tok-2", 42, "timeout");

    // Explicit driver-app channel id, not the default "order_channel" —
    // that one belongs to the customer app's separate codebase, and
    // referencing a channel id the driver app never created makes Android
    // fall back to its own uncontrolled default notification behavior
    // (confirmed live as the cause of this exact notification ringing
    // indefinitely until manually cleared).
    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-2",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ type: "order_dismiss", order_id: "42", reason: "timeout" }),
      "order_dismiss_channel_v1"
    );
  });

  it("preserves the expired model identity in delayed dismiss pushes", async () => {
    await pushNotifier.notifyDriverDismiss("tok", 42, "timeout", { package_id: 7, expires_at: 15000 });
    expect(sendPushNotification).toHaveBeenCalledWith("tok", expect.any(String), expect.any(String),
      expect.objectContaining({ order_id: "42", package_id: "7", expires_at: "15000", reason: "timeout" }),
      "order_dismiss_channel_v1");
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

  it("notifyCustomerOrderLive sends a searching-for-driver push naming the order id", async () => {
    await pushNotifier.notifyCustomerOrderLive("tok-5", 55);

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-5",
      expect.any(String),
      expect.stringContaining("55"),
      expect.objectContaining({ type: "schedule_live", order_id: "55" })
    );
  });

  it("notifyCustomerLatePickup sends a may-be-late push mentioning the order id and schedule time", async () => {
    await pushNotifier.notifyCustomerLatePickup("tok-6", 55, "2026-09-22T15:00:00.000Z");

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-6",
      expect.any(String),
      expect.stringContaining("55"),
      expect.objectContaining({
        type: "schedule_late_pickup",
        order_id: "55",
        schedule_date_time: "2026-09-22T15:00:00.000Z",
      })
    );
  });
});
