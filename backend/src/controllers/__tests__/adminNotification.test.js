const { send, history, getRecipients } = require("../adminNotificationController");
const prisma = require("../../config/db");
const { sendMulticastNotification } = require("../../config/firebase");

jest.mock("../../config/db", () => ({
  tbl_rider: {
    findMany: jest.fn(),
  },
  tbl_user: {
    findMany: jest.fn(),
  },
  tbl_rnoti: {
    createMany: jest.fn(),
  },
  tbl_notification: {
    createMany: jest.fn(),
  },
}));

jest.mock("../../config/firebase", () => ({
  sendMulticastNotification: jest.fn().mockResolvedValue({ sent: 2, failed: 0 }),
}));

describe("adminNotificationController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("send", () => {
    it("validates missing title and message", async () => {
      const req = { body: {}, user: { id: 1, role: "admin" } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await send(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining("title is required") })
      );

      const req2 = { body: { title: "Super Offer" }, user: { id: 1 } };
      const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await send(req2, res2);
      expect(res2.status).toHaveBeenCalledWith(400);
      expect(res2.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining("message") })
      );
    });

    it("returns 400 if no recipients found", async () => {
      prisma.tbl_rider.findMany.mockResolvedValue([]);
      prisma.tbl_user.findMany.mockResolvedValue([]);

      const req = {
        body: {
          title: "Flash Sale",
          message: "50% off your next 3 deliveries!",
          target_type: "all_drivers",
        },
        user: { id: 1 },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await send(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining("No active recipients") })
      );
    });

    it("successfully broadcasts offer to all drivers with FCM push and in-app inbox", async () => {
      const mockDrivers = [
        { id: 101, full_name: "Ramesh Driver", fmobile: "9876543210", fcm_token: "token_driver_101" },
        { id: 102, full_name: "Suresh Driver", fmobile: "9876543211", fcm_token: "token_driver_102" },
      ];
      prisma.tbl_rider.findMany.mockResolvedValue(mockDrivers);
      prisma.tbl_rnoti.createMany.mockResolvedValue({ count: 2 });

      const req = {
        body: {
          title: "Weekend Incentive",
          message: "Earn 20% bonus payout on all completed weekend trips!",
          target_type: "all_drivers",
          notification_type: "offer",
          image_url: "https://example.com/banner.png",
        },
        user: { id: 2, username: "admin_super" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await send(req, res);

      expect(prisma.tbl_rider.findMany).toHaveBeenCalled();
      expect(prisma.tbl_rnoti.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ rid: 101, title: "Weekend Incentive" }),
          expect.objectContaining({ rid: 102, title: "Weekend Incentive" }),
        ]),
      });
      expect(sendMulticastNotification).toHaveBeenCalledWith(
        ["token_driver_101", "token_driver_102"],
        "Weekend Incentive",
        "Earn 20% bonus payout on all completed weekend trips!",
        expect.objectContaining({ type: "promo", notification_type: "offer", image_url: "https://example.com/banner.png" }),
        "order_dismiss_channel_v1",
        "https://example.com/banner.png"
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            drivers_count: 2,
            customers_count: 0,
            total_targeted: 2,
          }),
        })
      );
    });

    it("successfully broadcasts to everyone (both drivers and customers)", async () => {
      prisma.tbl_rider.findMany.mockResolvedValue([
        { id: 1, full_name: "Driver 1", fcm_token: "mock_fcm_token_driver_001" },
      ]);
      prisma.tbl_user.findMany.mockResolvedValue([
        { id: 10, name: "Customer 10", fcm_token: "mock_fcm_token_cust_001" },
      ]);
      prisma.tbl_rnoti.createMany.mockResolvedValue({ count: 1 });
      prisma.tbl_notification.createMany.mockResolvedValue({ count: 1 });

      const req = {
        body: {
          title: "Diwali Special Offer",
          message: "Flat ₹100 Off on all moving orders today!",
          target_type: "all_everyone",
          notification_type: "offer",
        },
        user: { id: 1, username: "superadmin" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await send(req, res);

      expect(prisma.tbl_rnoti.createMany).toHaveBeenCalled();
      expect(prisma.tbl_notification.createMany).toHaveBeenCalled();
      expect(sendMulticastNotification).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            drivers_count: 1,
            customers_count: 1,
            total_targeted: 2,
          }),
        })
      );
    });

    it("successfully targets a driver by 10-digit mobile number", async () => {
      prisma.tbl_rider.findMany.mockResolvedValue([
        { id: 42, full_name: "Rahul Driver", fmobile: "9876543210", fcm_token: "mock_fcm_token_rahul_9876" },
      ]);
      prisma.tbl_rnoti.createMany.mockResolvedValue({ count: 1 });

      const req = {
        body: {
          title: "Personal Alert",
          message: "Please submit your renewed RC document.",
          target_type: "specific_driver",
          target_identifier: "9876543210",
        },
        user: { id: 1 },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await send(req, res);

      expect(prisma.tbl_rider.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: 1,
          OR: [
            { fmobile: { contains: "9876543210" } },
            { smobile: { contains: "9876543210" } },
          ],
        }),
        select: expect.anything(),
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ drivers_count: 1, customers_count: 0 }),
        })
      );
    });

    it("returns 404 if specific driver mobile number is not found", async () => {
      prisma.tbl_rider.findMany.mockResolvedValue([]);

      const req = {
        body: {
          title: "Alert",
          message: "Hello",
          target_type: "specific_driver",
          target_identifier: "9999999999",
        },
        user: { id: 1 },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await send(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining("9999999999") })
      );
    });
  });

  describe("history", () => {
    it("returns broadcast history array", async () => {
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await history(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
        })
      );
    });
  });

  describe("getRecipients", () => {
    it("returns active drivers and customers for the dropdown selector", async () => {
      prisma.tbl_rider.findMany.mockResolvedValue([
        {
          id: 1,
          full_name: "Ramesh Rider",
          fmobile: "9876543210",
          vehicle: "Bike",
          vehicle_no: "MP09AB1234",
          fcm_token: "mock_fcm_token_valid_12345",
        },
      ]);
      prisma.tbl_user.findMany.mockResolvedValue([
        {
          id: 10,
          name: "Priya Customer",
          mobile: 9876543211,
          email: "priya@gmail.com",
          fcm_token: "mock_fcm_token_user_valid_12345",
        },
      ]);

      const req = { query: { type: "all" } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getRecipients(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            drivers: expect.arrayContaining([
              expect.objectContaining({ id: 1, name: "Ramesh Rider", mobile: "9876543210", has_fcm: true }),
            ]),
            customers: expect.arrayContaining([
              expect.objectContaining({ id: 10, name: "Priya Customer", mobile: "9876543211", has_fcm: true }),
            ]),
          }),
        })
      );
    });
  });
});
