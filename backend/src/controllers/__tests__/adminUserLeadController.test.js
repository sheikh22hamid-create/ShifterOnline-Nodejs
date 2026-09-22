jest.mock("../../config/db", () => ({
  tbl_user: { findMany: jest.fn() },
  tbl_driver_lead: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
}));
jest.mock("../../services/leadInviteNotifier", () => ({
  sendLeadInvite: jest.fn(),
}));

const prisma = require("../../config/db");
const leadInviteNotifier = require("../../services/leadInviteNotifier");
const { listUserLeads, verifyLead, rejectLead, exportUserLeads } = require("../adminUserLeadController");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe("adminUserLeadController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("listUserLeads", () => {
    it("returns enriched list of user-submitted leads and counts", async () => {
      const mockLeads = [
        { id: 1, user_id: 10, lead_type: "customer", name: "Client A", phone: "9876543210", status: "pending", submitted_at: new Date() },
      ];
      prisma.tbl_driver_lead.findMany.mockResolvedValueOnce(mockLeads).mockResolvedValueOnce([{ user_id: 10 }]);
      prisma.tbl_user.findMany
        .mockResolvedValueOnce([{ id: 10, name: "Pooja User", mobile: 9988776655, email: "p@x.com", referral_points: 200 }])
        .mockResolvedValueOnce([{ id: 10, name: "Pooja User", mobile: 9988776655 }]);
      prisma.tbl_driver_lead.groupBy.mockResolvedValueOnce([{ status: "pending", _count: { id: 1 } }]).mockResolvedValueOnce([{ lead_type: "customer", _count: { id: 1 } }]);

      const res = mockRes();
      await listUserLeads({ query: { status: "pending", type: "all" } }, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              id: 1,
              user: expect.objectContaining({ name: "Pooja User", mobile: "9988776655" }),
            }),
          ]),
          counts: expect.objectContaining({ pending: 1, total: 1 }),
        })
      );
    });
  });

  describe("verifyLead", () => {
    it("verifies lead and dispatches auto invite", async () => {
      prisma.tbl_driver_lead.findUnique.mockResolvedValue({ id: 5, status: "pending", phone: "9876543210" });
      prisma.tbl_referral_setting.findFirst.mockResolvedValue({ lead_verification_window_days: 45 });
      prisma.tbl_driver_lead.update.mockResolvedValue({ id: 5, status: "verified" });
      leadInviteNotifier.sendLeadInvite.mockResolvedValue({ success: true, whatsapp: true });

      const res = mockRes();
      await verifyLead({ params: { id: "5" }, user: { id: 1 } }, res);

      expect(prisma.tbl_driver_lead.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({ status: "verified", verified_by_admin_id: 1 }),
      });
      expect(leadInviteNotifier.sendLeadInvite).toHaveBeenCalledWith(5);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, invite: { success: true, whatsapp: true } }));
    });
  });

  describe("exportUserLeads", () => {
    it("exports CSV formatted spreadsheet with headers and UTF-8 BOM", async () => {
      prisma.tbl_driver_lead.findMany.mockResolvedValue([
        { id: 1, user_id: 10, lead_type: "customer", name: "Client A", phone: "9876543210", status: "pending", submitted_at: new Date("2026-09-22") },
      ]);
      prisma.tbl_user.findMany.mockResolvedValue([{ id: 10, name: "Pooja", mobile: 9988776655 }]);

      const res = mockRes();
      await exportUserLeads({ query: { status: "all" } }, res);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Lead ID,Contact Name,Contact Phone"));
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Pooja"));
    });
  });
});
