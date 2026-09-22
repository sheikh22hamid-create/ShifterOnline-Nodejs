jest.mock("../../config/db", () => ({
  tbl_user: { findFirst: jest.fn(), findMany: jest.fn() },
  tbl_rider: { findFirst: jest.fn() },
  tbl_driver_lead: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
}));

const prisma = require("../../config/db");
const { submitLeads, listMyLeads } = require("../userLeadController");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("userLeadController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("submitLeads", () => {
    it("returns error if uid is missing", async () => {
      const res = mockRes();
      await submitLeads({ body: { contacts: [{ phone: "9876543210" }] } }, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ Result: "false", ResponseCode: "400", ResponseMsg: "User ID is required." })
      );
    });

    it("returns error if contacts array is empty", async () => {
      const res = mockRes();
      await submitLeads({ body: { uid: 10, contacts: [] } }, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ Result: "false", ResponseCode: "400", ResponseMsg: "At least one contact is required." })
      );
    });

    it("submits customer leads cleanly and sets referrer_type to user", async () => {
      prisma.tbl_user.findFirst.mockResolvedValue(null);
      prisma.tbl_rider.findFirst.mockResolvedValue(null);
      prisma.tbl_driver_lead.findFirst.mockResolvedValue(null);
      prisma.tbl_driver_lead.create.mockResolvedValue({ id: 101 });

      const res = mockRes();
      await submitLeads(
        {
          body: {
            uid: 10,
            lead_type: "customer",
            contacts: [
              { name: "Aarav", phone: "+91 98765 43210" },
              { name: "Invalid", phone: "123" },
            ],
          },
        },
        res
      );

      expect(prisma.tbl_driver_lead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          driver_id: 0,
          user_id: 10,
          referrer_type: "user",
          lead_type: "customer",
          name: "Aarav",
          phone: "9876543210",
          status: "pending",
        }),
      });

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          Result: "true",
          accepted: 1,
          skipped: expect.arrayContaining([expect.objectContaining({ reason: "invalid_phone" })]),
        })
      );
    });

    it("submits driver leads cleanly with lead_type driver", async () => {
      prisma.tbl_user.findFirst.mockResolvedValue(null);
      prisma.tbl_rider.findFirst.mockResolvedValue(null);
      prisma.tbl_driver_lead.findFirst.mockResolvedValue(null);
      prisma.tbl_driver_lead.create.mockResolvedValue({ id: 102 });

      const res = mockRes();
      await submitLeads(
        {
          body: {
            uid: 15,
            lead_type: "driver",
            contacts: [{ name: "Driver Rahul", phone: "9876500000" }],
          },
        },
        res
      );

      expect(prisma.tbl_driver_lead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 15,
          referrer_type: "user",
          lead_type: "driver",
          phone: "9876500000",
        }),
      });
    });

    it("skips already registered user or driver", async () => {
      prisma.tbl_user.findFirst.mockResolvedValue({ id: 99 });
      prisma.tbl_rider.findFirst.mockResolvedValue(null);
      prisma.tbl_driver_lead.findFirst.mockResolvedValue(null);

      const res = mockRes();
      await submitLeads(
        {
          body: {
            uid: 10,
            contacts: [{ name: "Registered User", phone: "9876543210" }],
          },
        },
        res
      );

      expect(prisma.tbl_driver_lead.create).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accepted: 0,
          skipped: expect.arrayContaining([expect.objectContaining({ reason: "already_registered" })]),
        })
      );
    });
  });

  describe("listMyLeads", () => {
    it("returns list of leads for the user", async () => {
      const mockList = [
        { id: 101, user_id: 10, referrer_type: "user", lead_type: "customer", name: "Aarav", phone: "9876543210", status: "pending" },
      ];
      prisma.tbl_driver_lead.findMany.mockResolvedValue(mockList);

      const res = mockRes();
      await listMyLeads({ query: { uid: 10 } }, res);

      expect(prisma.tbl_driver_lead.findMany).toHaveBeenCalledWith({
        where: { user_id: 10, referrer_type: "user" },
        orderBy: { id: "desc" },
      });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", leads: mockList }));
    });
  });
});
