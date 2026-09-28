jest.mock("../../config/db", () => ({
  tbl_registration_lead: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
}));
jest.mock("../../services/registrationLeadService", () => ({
  sendReminder: jest.fn(),
}));

const prisma = require("../../config/db");
const registrationLeadService = require("../../services/registrationLeadService");
const { listLeads, sendReminder, updateStatus } = require("../adminRegistrationLeadController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("adminRegistrationLeadController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("listLeads defaults to pending status", async () => {
    prisma.tbl_registration_lead.findMany.mockResolvedValue([]);
    prisma.tbl_registration_lead.groupBy.mockResolvedValue([]);
    const res = mockRes();
    await listLeads({ query: {} }, res);
    expect(prisma.tbl_registration_lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending" } })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("listLeads passes through an explicit status filter", async () => {
    prisma.tbl_registration_lead.findMany.mockResolvedValue([]);
    prisma.tbl_registration_lead.groupBy.mockResolvedValue([]);
    const res = mockRes();
    await listLeads({ query: { status: "contacted" } }, res);
    expect(prisma.tbl_registration_lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "contacted" } })
    );
  });

  it("sendReminder delegates to the service and returns its result", async () => {
    registrationLeadService.sendReminder.mockResolvedValue({ whatsapp: true, sms: false, phone: "9990001111" });
    const res = mockRes();
    await sendReminder({ params: { id: "7" } }, res);
    expect(registrationLeadService.sendReminder).toHaveBeenCalledWith(7);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("sendReminder 404s when the lead doesn't exist", async () => {
    registrationLeadService.sendReminder.mockRejectedValue(new Error("Lead not found"));
    const res = mockRes();
    await sendReminder({ params: { id: "999" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updateStatus rejects an invalid status value", async () => {
    const res = mockRes();
    await updateStatus({ params: { id: "1" }, body: { status: "bogus" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_registration_lead.update).not.toHaveBeenCalled();
  });

  it("updateStatus 404s on unknown id", async () => {
    prisma.tbl_registration_lead.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await updateStatus({ params: { id: "999" }, body: { status: "contacted" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updateStatus updates a valid lead", async () => {
    prisma.tbl_registration_lead.findUnique.mockResolvedValue({ id: 1, status: "pending" });
    prisma.tbl_registration_lead.update.mockResolvedValue({ id: 1, status: "dismissed" });
    const res = mockRes();
    await updateStatus({ params: { id: "1" }, body: { status: "dismissed" } }, res);
    expect(prisma.tbl_registration_lead.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "dismissed" },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
