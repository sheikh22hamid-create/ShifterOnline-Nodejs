jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  driver_duty_log: { findFirst: jest.fn().mockResolvedValue(null) },
  daily_driver_duty_log: { findFirst: jest.fn().mockResolvedValue(null) },
}));
jest.mock("../../sockets/adminSocket", () => ({ notifyDriverStatusUpdate: jest.fn() }));

const prisma = require("../../config/db");
const { setStatus } = require("../riderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("riderController.setStatus trial gating", () => {
  afterEach(() => jest.clearAllMocks());

  it("blocks going online when trial is exhausted and KYC isn't approved", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 5, trial_status: "exhausted", verification_status: "pending",
    });
    const res = makeRes();
    await setStatus({ body: { rider_id: 5, a_status: 1 } }, res);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("blocks going online when trial was manually blocked by an admin", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 6, trial_status: "blocked", verification_status: "pending",
    });
    const res = makeRes();
    await setStatus({ body: { rider_id: 6, a_status: 1 } }, res);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("allows going online while trial is active, even though KYC is still pending", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 7, trial_status: "active", verification_status: "pending",
    });
    prisma.tbl_rider.update.mockResolvedValue({ id: 7, city_id: 1, a_status: 1, status: 1 });
    const res = makeRes();
    await setStatus({ body: { rider_id: 7, a_status: 1 } }, res);
    expect(prisma.tbl_rider.update).toHaveBeenCalled();
  });

  it("still allows a fully-approved, non-trial driver to go online (no regression)", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 8, trial_status: "none", verification_status: "approved",
    });
    prisma.tbl_rider.update.mockResolvedValue({ id: 8, city_id: 1, a_status: 1, status: 1 });
    const res = makeRes();
    await setStatus({ body: { rider_id: 8, a_status: 1 } }, res);
    expect(prisma.tbl_rider.update).toHaveBeenCalled();
  });

  // Review Focus: a plain unverified driver who was never in a trial at all
  // (trial_status='none') must still be rejected - the new "isActiveTrial"
  // branch must not accidentally widen eligibility for the ordinary
  // never-verified case this feature isn't meant to touch.
  it("blocks a never-trial, never-approved driver from going online", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 11, trial_status: "none", verification_status: "pending",
    });
    const res = makeRes();
    await setStatus({ body: { rider_id: 11, a_status: 1 } }, res);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("going offline never requires the trial/KYC check", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 9, trial_status: "none", verification_status: "pending",
    });
    prisma.tbl_rider.update.mockResolvedValue({ id: 9, city_id: 1, a_status: 0, status: 1 });
    const res = makeRes();
    await setStatus({ body: { rider_id: 9, a_status: 0 } }, res);
    expect(prisma.tbl_rider.update).toHaveBeenCalled();
  });
});
