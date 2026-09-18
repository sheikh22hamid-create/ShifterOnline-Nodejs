jest.mock("../../config/db", () => ({
  tbl_driver_lead: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
}));

const prisma = require("../../config/db");
const { listLeads, verifyLead, rejectLead } = require("../adminDriverLeadController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("adminDriverLeadController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("listLeads defaults to pending status", async () => {
    prisma.tbl_driver_lead.findMany.mockResolvedValue([]);
    const res = mockRes();
    await listLeads({ query: {} }, res);
    expect(prisma.tbl_driver_lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending" } })
    );
  });

  it("verifyLead sets status verified with an expiry from settings", async () => {
    prisma.tbl_driver_lead.findUnique.mockResolvedValue({ id: 5, status: "pending" });
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ lead_verification_window_days: 30 });
    prisma.tbl_driver_lead.update.mockResolvedValue({ id: 5, status: "verified" });
    const res = mockRes();

    await verifyLead({ params: { id: "5" }, user: { id: 77 } }, res);

    const call = prisma.tbl_driver_lead.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 5 });
    expect(call.data.status).toBe("verified");
    expect(call.data.verified_by_admin_id).toBe(77);
    const daysDiff = Math.round((call.data.expires_at - call.data.verified_at) / (24 * 60 * 60 * 1000));
    expect(daysDiff).toBe(30);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("verifyLead 404s on unknown id", async () => {
    prisma.tbl_driver_lead.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await verifyLead({ params: { id: "999" }, user: { id: 77 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("verifyLead rejects a lead that isn't pending", async () => {
    prisma.tbl_driver_lead.findUnique.mockResolvedValue({ id: 5, status: "converted" });
    const res = mockRes();
    await verifyLead({ params: { id: "5" }, user: { id: 77 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_driver_lead.update).not.toHaveBeenCalled();
  });

  it("rejectLead sets status rejected", async () => {
    prisma.tbl_driver_lead.findUnique.mockResolvedValue({ id: 5, status: "pending" });
    prisma.tbl_driver_lead.update.mockResolvedValue({ id: 5, status: "rejected" });
    const res = mockRes();

    await rejectLead({ params: { id: "5" }, user: { id: 77 } }, res);

    expect(prisma.tbl_driver_lead.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: "rejected", verified_by_admin_id: 77 }),
    });
  });
});
