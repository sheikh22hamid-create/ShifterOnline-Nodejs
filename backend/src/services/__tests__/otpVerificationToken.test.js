jest.mock("../../config/db", () => ({
  tbl_otp: { findFirst: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

process.env.JWT_SECRET = "test-secret";
const prisma = require("../../config/db");
const otpService = require("../otpService");

describe("otpService verification token", () => {
  afterEach(() => jest.clearAllMocks());

  it("issues a token only for a verified OTP row and accepts it once", async () => {
    prisma.tbl_otp.findFirst.mockResolvedValue({ id: 7, mobile: "9998887777", status: 1, created_at: new Date() });
    const token = await otpService.issueVerificationToken("9998887777");
    expect(token).toMatch(/^7\./);

    prisma.tbl_otp.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await otpService.checkVerificationToken(token, "9998887777", 60000, { consume: true })).toBe(true);
    expect(await otpService.checkVerificationToken(token, "9998887777", 60000, { consume: true })).toBe(false);
  });

  it("rejects a token for another mobile, a tampered token and an expired OTP", async () => {
    prisma.tbl_otp.findFirst.mockResolvedValue({ id: 7, mobile: "9998887777", status: 1, created_at: new Date() });
    const token = await otpService.issueVerificationToken("9998887777");

    expect(await otpService.checkVerificationToken(token, "9000000000", 60000)).toBe(false);
    expect(await otpService.checkVerificationToken(`7.${"0".repeat(64)}`, "9998887777", 60000)).toBe(false);

    prisma.tbl_otp.findFirst.mockResolvedValue({ id: 7, mobile: "9998887777", status: 1, created_at: new Date(Date.now() - 120000) });
    expect(await otpService.checkVerificationToken(token, "9998887777", 60000)).toBe(false);
  });

  it("issues no token when the latest OTP is not verified", async () => {
    prisma.tbl_otp.findFirst.mockResolvedValue({ id: 8, mobile: "9998887777", status: 0, created_at: new Date() });
    expect(await otpService.issueVerificationToken("9998887777")).toBe("");
  });
});
