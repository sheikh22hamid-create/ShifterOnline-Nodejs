jest.mock("../../config/db", () => ({ tbl_user: { findFirst: jest.fn() }, tbl_notification: { create: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
const prisma = require("../../config/db");
const { saveCustomerNotification, saveCustomerNotificationByToken } = require("../customerInbox");

beforeEach(() => jest.clearAllMocks());

it("writes an inbox row for the user", async () => {
  await saveCustomerNotification(7, "Order Assigned!", "Ravi is on the way.");
  expect(prisma.tbl_notification.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ uid: 7, title: "Order Assigned!", description: "Ravi is on the way." }),
  });
});

it("looks the user up by device token", async () => {
  prisma.tbl_user.findFirst.mockResolvedValue({ id: 9 });
  await saveCustomerNotificationByToken("tok", "T", "D");
  expect(prisma.tbl_notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ uid: 9 }) });
});

it("does nothing without a token/user and never throws", async () => {
  await saveCustomerNotificationByToken(undefined, "T", "D");
  prisma.tbl_user.findFirst.mockResolvedValue(null);
  await saveCustomerNotificationByToken("x", "T", "D");
  prisma.tbl_notification.create.mockRejectedValue(new Error("db down"));
  await expect(saveCustomerNotification(1, "T", "D")).resolves.toBeUndefined();
  expect(prisma.tbl_notification.create).toHaveBeenCalledTimes(1);
});
