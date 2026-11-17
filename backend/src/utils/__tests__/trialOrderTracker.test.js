jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));

const prisma = require("../../config/db");
const { recordTrialOrderCompletion } = require("../trialOrderTracker");

describe("trialOrderTracker.recordTrialOrderCompletion", () => {
  afterEach(() => jest.clearAllMocks());

  it("does nothing for a rider who isn't in an active trial", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 1, trial_status: "none", trial_orders_allowed: null, trial_orders_completed: 0, a_status: 1,
    });
    await recordTrialOrderCompletion(1);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("does nothing if the rider no longer exists", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    await recordTrialOrderCompletion(999);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("increments the counter and stays active when under the limit", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 2, trial_status: "active", trial_orders_allowed: 5, trial_orders_completed: 2, a_status: 1,
    });
    await recordTrialOrderCompletion(2);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { trial_orders_completed: 3, trial_status: "active", a_status: 1 },
    });
  });

  it("flips to exhausted and blocks dispatch exactly at the limit", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 3, trial_status: "active", trial_orders_allowed: 5, trial_orders_completed: 4, a_status: 1,
    });
    await recordTrialOrderCompletion(3);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { trial_orders_completed: 5, trial_status: "exhausted", a_status: 0 },
    });
  });
  it("does not count a WhatsApp-channel order", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ driver_channel: "whatsapp" });
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 4, trial_status: "active", trial_orders_allowed: 1, trial_orders_completed: 0, a_status: 1,
    });
    await recordTrialOrderCompletion(4, 77);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("counts an app-channel order and exhausts at allowed 1", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ driver_channel: "app" });
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 5, trial_status: "active", trial_orders_allowed: 1, trial_orders_completed: 0, a_status: 1,
    });
    await recordTrialOrderCompletion(5, 78);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { trial_orders_completed: 1, trial_status: "exhausted", a_status: 0 },
    });
  });

  it("without an orderId keeps the old behaviour and skips the order lookup", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 6, trial_status: "active", trial_orders_allowed: 5, trial_orders_completed: 0, a_status: 1,
    });
    await recordTrialOrderCompletion(6);
    expect(prisma.pkg_order.findUnique).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).toHaveBeenCalled();
  });
});
