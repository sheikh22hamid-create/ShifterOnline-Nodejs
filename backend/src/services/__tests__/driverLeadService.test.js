jest.mock("../../config/db", () => ({
  tbl_driver_lead: { updateMany: jest.fn() },
}));

const prisma = require("../../config/db");
const { expireStaleLeads } = require("../driverLeadService");

describe("driverLeadService.expireStaleLeads", () => {
  it("flips verified leads past their expiry to expired", async () => {
    prisma.tbl_driver_lead.updateMany.mockResolvedValue({ count: 3 });

    const result = await expireStaleLeads();

    expect(prisma.tbl_driver_lead.updateMany).toHaveBeenCalledWith({
      where: { status: "verified", expires_at: { lt: expect.any(Date) } },
      data: { status: "expired" },
    });
    expect(result).toEqual({ count: 3 });
  });

  it("handles DB error gracefully without throwing", async () => {
    prisma.tbl_driver_lead.updateMany.mockRejectedValue(new Error("DB error"));
    const result = await expireStaleLeads();
    expect(result).toEqual({ count: 0 });
  });
});
