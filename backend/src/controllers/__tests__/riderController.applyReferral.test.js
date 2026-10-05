// A driver who applies a referral code AFTER registering must get the same
// one-time sign-up bonus as one who entered it at signup.
jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  tbl_user: { findFirst: jest.fn() },
  tbl_referral: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock("../../sockets/adminSocket", () => ({}));
jest.mock("../../services/referralRewardService", () => ({ creditSignUpBonus: jest.fn().mockResolvedValue(50) }));

const prisma = require("../../config/db");
const referralRewardService = require("../../services/referralRewardService");
const { applyReferral } = require("../riderController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tbl_rider.findUnique.mockResolvedValue({ id: 38, reffer_code: "MINE1", referred_by: 0 });
  prisma.tbl_referral.findFirst.mockResolvedValue(null);
  prisma.tbl_rider.findFirst.mockResolvedValue({ id: 12 });
  prisma.tbl_referral.create.mockResolvedValue({});
  prisma.tbl_rider.update.mockResolvedValue({});
});

describe("riderController.applyReferral sign-up bonus", () => {
  it("credits the sign-up bonus to the applying driver once the referral is recorded", async () => {
    const r = res();
    await applyReferral({ body: { rider_id: 38, referral_code: "abc123" } }, r);
    expect(prisma.tbl_referral.create).toHaveBeenCalledTimes(1);
    expect(referralRewardService.creditSignUpBonus).toHaveBeenCalledWith({ referredId: 38, referredType: "DRIVER" });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", ResponseCode: "200" }));
  });

  it("no bonus when the code is already applied", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 38, reffer_code: "MINE1", referred_by: 12 });
    await applyReferral({ body: { rider_id: 38, referral_code: "ABC123" } }, res());
    expect(referralRewardService.creditSignUpBonus).not.toHaveBeenCalled();
  });

  it("no bonus for an invalid code or the driver's own code", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    prisma.tbl_user.findFirst.mockResolvedValue(null);
    await applyReferral({ body: { rider_id: 38, referral_code: "NOPE" } }, res());
    await applyReferral({ body: { rider_id: 38, referral_code: "MINE1" } }, res());
    expect(referralRewardService.creditSignUpBonus).not.toHaveBeenCalled();
  });
});
