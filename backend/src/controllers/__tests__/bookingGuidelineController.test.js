const prisma = require("../../config/db");
const controller = require("../bookingGuidelineController");

jest.mock("../../config/db", () => ({
  tbl_booking_guideline: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("bookingGuidelineController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("customer list returns only active guidelines as id + text", async () => {
    prisma.tbl_booking_guideline.findMany.mockResolvedValue([{ id: 1, text: "Pay tolls", status: true, sort_order: 1 }]);
    const res = mockRes();
    await controller.listActiveBookingGuidelines({}, res);

    expect(prisma.tbl_booking_guideline.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: true } }));
    expect(res.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: true, data: [{ id: 1, text: "Pay tolls" }] });
  });

  it("rejects a blank guideline on create", async () => {
    const res = mockRes();
    await controller.createBookingGuideline({ body: { text: "   " } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_booking_guideline.create).not.toHaveBeenCalled();
  });

  it("creates, updates and deletes", async () => {
    prisma.tbl_booking_guideline.create.mockResolvedValue({ id: 3, text: "New" });
    let res = mockRes();
    await controller.createBookingGuideline({ body: { text: " New ", sort_order: "5" } }, res);
    expect(prisma.tbl_booking_guideline.create).toHaveBeenCalledWith({ data: { text: "New", sort_order: 5 } });
    expect(res.status).toHaveBeenCalledWith(201);

    prisma.tbl_booking_guideline.findUnique.mockResolvedValue({ id: 3 });
    prisma.tbl_booking_guideline.update.mockResolvedValue({ id: 3, text: "Edited", status: false });
    res = mockRes();
    await controller.updateBookingGuideline({ params: { id: "3" }, body: { text: "Edited", status: false } }, res);
    expect(prisma.tbl_booking_guideline.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { text: "Edited", status: false } });

    res = mockRes();
    await controller.deleteBookingGuideline({ params: { id: "3" } }, res);
    expect(prisma.tbl_booking_guideline.delete).toHaveBeenCalledWith({ where: { id: 3 } });
  });

  it("404s when updating a missing guideline", async () => {
    prisma.tbl_booking_guideline.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await controller.updateBookingGuideline({ params: { id: "9" }, body: { text: "x" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
