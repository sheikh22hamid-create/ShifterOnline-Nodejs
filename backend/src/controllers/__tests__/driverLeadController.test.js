jest.mock("../../config/db", () => ({
  tbl_driver_lead: { findMany: jest.fn(), findFirst: jest.fn(), createMany: jest.fn(), create: jest.fn() },
  tbl_user: { findFirst: jest.fn() },
  tbl_rider: { findFirst: jest.fn() },
}));

const prisma = require("../../config/db");
const { submitLeads, listMyLeads } = require("../driverLeadController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("driverLeadController.submitLeads", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_user.findFirst.mockResolvedValue(null);
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    prisma.tbl_driver_lead.findFirst.mockResolvedValue(null);
    prisma.tbl_driver_lead.create.mockResolvedValue({ id: 1 });
  });

  it("rejects with no rider_id", async () => {
    const res = mockRes();
    await submitLeads({ body: { rider_id: 0, contacts: [{ name: "A", phone: "9998887771" }] } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false", ResponseCode: "400" }));
  });

  it("accepts a new, unregistered, unclaimed number", async () => {
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "9998887771" }] } }, res);

    expect(prisma.tbl_driver_lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ driver_id: 55, name: "Ravi", phone: "9998887771", status: "pending" }),
    });
    const payload = res.json.mock.calls[0][0];
    expect(payload.Result).toBe("true");
    expect(payload.accepted).toBe(1);
    expect(payload.skipped).toHaveLength(0);
  });

  it("skips a number already registered as a customer", async () => {
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 9 });
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "9998887771" }] } }, res);

    expect(prisma.tbl_driver_lead.create).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.accepted).toBe(0);
    expect(payload.skipped[0]).toEqual(expect.objectContaining({ phone: "9998887771", reason: "already_registered" }));
  });

  it("skips a number another driver already submitted", async () => {
    prisma.tbl_driver_lead.findFirst.mockResolvedValue({ id: 3, driver_id: 999 });
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "9998887771" }] } }, res);

    expect(prisma.tbl_driver_lead.create).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.skipped[0]).toEqual(expect.objectContaining({ phone: "9998887771", reason: "already_submitted" }));
  });

  it("strips non-digit characters and takes last 10 digits to normalize country code", async () => {
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "+91 999-888-7771" }] } }, res);

    expect(prisma.tbl_driver_lead.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: "9998887771" }) })
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.accepted).toBe(1);
  });

  it("matches +91-prefixed contact against existing bare 10-digit user (cross-format dedup)", async () => {
    // Simulates: contact submitted as "+91 9998887771", existing user stored as bare "9998887771"
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 123, mobile: 9998887771 });
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "+91 9998887771" }] } }, res);

    // Should find the user via normalized 10-digit lookup
    expect(prisma.tbl_user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mobile: 9998887771 } })
    );
    // Should NOT create a lead (already registered)
    expect(prisma.tbl_driver_lead.create).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.skipped[0]).toEqual(expect.objectContaining({ phone: "9998887771", reason: "already_registered" }));
  });
});

describe("driverLeadController.listMyLeads", () => {
  it("returns this driver's leads only", async () => {
    prisma.tbl_driver_lead.findMany.mockResolvedValue([{ id: 1, driver_id: 55, name: "Ravi", phone: "1", status: "pending" }]);
    const res = mockRes();
    await listMyLeads({ query: { rider_id: "55" } }, res);

    expect(prisma.tbl_driver_lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { driver_id: 55 } })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true" }));
  });
});
