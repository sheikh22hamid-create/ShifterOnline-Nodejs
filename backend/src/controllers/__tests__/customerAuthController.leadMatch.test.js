jest.mock("../../config/db", () => ({
  tbl_user: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_rider: { findFirst: jest.fn() },
  tbl_referral: { create: jest.fn() },
  tbl_favorite_driver: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  tbl_driver_lead: { findFirst: jest.fn(), update: jest.fn() },
}));
jest.mock("../../services/deviceSessionService", () => ({ registerDevice: jest.fn() }));

const prisma = require("../../config/db");
const { register } = require("../customerAuthController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("customerAuthController.register — lead match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_user.findFirst.mockResolvedValue(null); // mobile/email not taken
    prisma.tbl_rider.findFirst.mockResolvedValue(null); // no referral code path
    prisma.tbl_user.create.mockResolvedValue({ id: 42 });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 42, wallet: 0 });
    prisma.tbl_favorite_driver.findFirst.mockResolvedValue(null);
  });

  it("creates a source:lead referral and favorites the driver when phone matches a verified lead", async () => {
    prisma.tbl_driver_lead.findFirst.mockResolvedValue({ id: 9, driver_id: 55, phone: "9998887771", status: "verified" });

    const res = mockRes();
    await register({ body: { fname: "Ravi", email: "r@x.com", mobile: "9998887771", password: "pw123456" } }, res);

    expect(prisma.tbl_referral.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referrer_id: 55,
        referrer_type: "DRIVER",
        referred_id: 42,
        referred_type: "USER",
        status: "pending",
        source: "lead",
      }),
    });
    expect(prisma.tbl_driver_lead.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ status: "converted", converted_user_id: 42 }),
    });
    expect(prisma.tbl_favorite_driver.create).toHaveBeenCalledWith({
      data: { user_id: 42, rider_id: 55, status: 1 },
    });
  });

  it("matches a lead stored as a bare 10-digit number when signup mobile has a country-code prefix", async () => {
    prisma.tbl_driver_lead.findFirst.mockResolvedValue({ id: 9, driver_id: 55, phone: "9998887771", status: "verified" });

    const res = mockRes();
    await register(
      { body: { fname: "Ravi", email: "r@x.com", mobile: "919998887771", password: "pw123456" } },
      res
    );

    expect(prisma.tbl_driver_lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ phone: "9998887771" }),
      })
    );
    expect(prisma.tbl_referral.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referrer_id: 55,
        referrer_type: "DRIVER",
        referred_id: 42,
        referred_type: "USER",
        status: "pending",
        source: "lead",
      }),
    });
    expect(prisma.tbl_favorite_driver.create).toHaveBeenCalledWith({
      data: { user_id: 42, rider_id: 55, status: 1 },
    });
  });

  it("does nothing extra when no lead matches the phone", async () => {
    prisma.tbl_driver_lead.findFirst.mockResolvedValue(null);

    const res = mockRes();
    await register({ body: { fname: "Ravi", email: "r@x.com", mobile: "9998887771", password: "pw123456" } }, res);

    expect(prisma.tbl_referral.create).not.toHaveBeenCalled();
    expect(prisma.tbl_favorite_driver.create).not.toHaveBeenCalled();
  });
});
