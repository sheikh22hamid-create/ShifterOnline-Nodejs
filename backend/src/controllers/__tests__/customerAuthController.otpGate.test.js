jest.mock("../../config/db", () => ({
  tbl_user: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_rider: { findFirst: jest.fn() },
  tbl_referral: { create: jest.fn() },
  tbl_favorite_driver: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  tbl_driver_lead: { findFirst: jest.fn(), update: jest.fn() },
  tbl_address: { count: jest.fn() },
}));
jest.mock("../../services/deviceSessionService", () => ({ registerDevice: jest.fn() }));
jest.mock("../../services/otpService", () => ({
  hasRecentVerifiedOtp: jest.fn(),
  normalizeMobile: (m) => String(m || ""),
}));
jest.mock("../../services/referralRewardService", () => ({ creditSignUpBonus: jest.fn() }));

const prisma = require("../../config/db");
const otpService = require("../../services/otpService");
const { creditSignUpBonus } = require("../../services/referralRewardService");
const { register, loginByOtp } = require("../customerAuthController");

const mockRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = (res) => res.json.mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  otpService.hasRecentVerifiedOtp.mockResolvedValue(true);
  prisma.tbl_user.findFirst.mockResolvedValue(null);
  prisma.tbl_rider.findFirst.mockResolvedValue(null);
  prisma.tbl_user.create.mockResolvedValue({ id: 42 });
  prisma.tbl_user.findUnique.mockResolvedValue({ id: 42, wallet: 0 });
  prisma.tbl_user.update.mockResolvedValue({});
  prisma.tbl_favorite_driver.findFirst.mockResolvedValue(null);
  prisma.tbl_driver_lead.findFirst.mockResolvedValue(null);
  prisma.tbl_address.count.mockResolvedValue(0);
});

describe("loginByOtp requires a verified OTP", () => {
  it("refuses to log in when the mobile's OTP was never verified", async () => {
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 7, mobile: 9876543210, status: 1, wallet: 0 });
    otpService.hasRecentVerifiedOtp.mockResolvedValue(false);

    const res = mockRes();
    await loginByOtp({ body: { mobile: "9876543210", ccode: "+91" } }, res);

    expect(body(res)).toMatchObject({ Result: "false", ResponseMsg: expect.stringMatching(/verify OTP/i) });
    expect(body(res).UserLogin).toBeUndefined();
  });

  it("logs in once the OTP was verified", async () => {
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 7, mobile: 9876543210, status: 1, wallet: 0 });

    const res = mockRes();
    await loginByOtp({ body: { mobile: "9876543210", ccode: "+91" } }, res);

    expect(otpService.hasRecentVerifiedOtp).toHaveBeenCalledWith("9876543210");
    expect(body(res)).toMatchObject({ Result: "true", ResponseMsg: "Login successfully!" });
  });
});

describe("register requires a verified OTP", () => {
  it("does not create an account when the OTP was never verified", async () => {
    otpService.hasRecentVerifiedOtp.mockResolvedValue(false);

    const res = mockRes();
    await register({ body: { fname: "Ravi", mobile: "9998887771" } }, res);

    expect(body(res)).toMatchObject({ Result: "false", ResponseMsg: expect.stringMatching(/verify OTP/i) });
    expect(prisma.tbl_user.create).not.toHaveBeenCalled();
  });
});

describe("register: referral code + matching lead", () => {
  it("applies the code only - no second referral row or second sign-up bonus from the lead", async () => {
    prisma.tbl_user.findFirst
      .mockResolvedValueOnce(null) // mobile not taken
      .mockResolvedValueOnce({ id: 3 }) // referral code belongs to customer 3
      .mockResolvedValue(null);
    prisma.tbl_driver_lead.findFirst.mockResolvedValue({ id: 9, driver_id: 55, phone: "9998887771", status: "verified" });

    const res = mockRes();
    await register({ body: { fname: "Ravi", mobile: "9998887771", referral_code: "abc12345" } }, res);

    expect(body(res).Result).toBe("true");
    expect(prisma.tbl_referral.create).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_referral.create).toHaveBeenCalledWith({ data: expect.objectContaining({ referrer_id: 3 }) });
    expect(prisma.tbl_driver_lead.update).not.toHaveBeenCalled();
    expect(creditSignUpBonus).toHaveBeenCalledTimes(1);
  });
});
