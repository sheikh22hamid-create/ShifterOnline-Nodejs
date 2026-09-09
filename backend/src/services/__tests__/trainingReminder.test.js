jest.mock("../../config/db", () => ({
  driver_training_progress: { findMany: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
}));
jest.mock("../pushNotifier", () => ({ notifyDriverTrainingIncomplete: jest.fn() }));

const prisma = require("../../config/db");
const { notifyDriverTrainingIncomplete } = require("../pushNotifier");
const { sweepIncompleteTraining } = require("../trainingReminder");

describe("trainingReminder.sweepIncompleteTraining", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reminds a driver who hasn't been reminded yet and has an fcm token", async () => {
    prisma.driver_training_progress.findMany.mockResolvedValue([{ rider_id: 9, last_reminded_at: null }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "token-abc" });
    notifyDriverTrainingIncomplete.mockResolvedValue({ sent: true });
    prisma.driver_training_progress.update.mockResolvedValue({});

    await sweepIncompleteTraining();

    expect(notifyDriverTrainingIncomplete).toHaveBeenCalledWith("token-abc");
    expect(prisma.driver_training_progress.update).toHaveBeenCalledWith({
      where: { rider_id: 9 },
      data: { last_reminded_at: expect.any(Date) },
    });
  });

  it("skips a driver with no fcm token without crashing the sweep", async () => {
    prisma.driver_training_progress.findMany.mockResolvedValue([{ rider_id: 9, last_reminded_at: null }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "" });

    await sweepIncompleteTraining();

    expect(notifyDriverTrainingIncomplete).not.toHaveBeenCalled();
    expect(prisma.driver_training_progress.update).not.toHaveBeenCalled();
  });

  it("keeps sweeping the rest of the batch if one driver's lookup throws", async () => {
    prisma.driver_training_progress.findMany.mockResolvedValue([
      { rider_id: 1, last_reminded_at: null },
      { rider_id: 2, last_reminded_at: null },
    ]);
    prisma.tbl_rider.findUnique.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ fcm_token: "token-2" });
    notifyDriverTrainingIncomplete.mockResolvedValue({ sent: true });
    prisma.driver_training_progress.update.mockResolvedValue({});

    await sweepIncompleteTraining();

    expect(notifyDriverTrainingIncomplete).toHaveBeenCalledTimes(1);
    expect(notifyDriverTrainingIncomplete).toHaveBeenCalledWith("token-2");
  });
});
