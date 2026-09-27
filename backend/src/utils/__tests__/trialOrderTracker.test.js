jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
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
});
