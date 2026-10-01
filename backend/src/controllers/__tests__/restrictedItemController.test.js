jest.mock("../../config/db", () => ({
  tbl_restricted_item: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
const prisma = require("../../config/db");
const c = require("../restrictedItemController");

function res() {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
}
beforeEach(() => jest.clearAllMocks());

describe("restrictedItemController", () => {
  it("customer list returns only active types ordered by sort_order then name", async () => {
    prisma.tbl_restricted_item.findMany.mockResolvedValue([{ id: 1, name: "Explosives", description: "No", status: true, sort_order: 0 }]);
    const r = res();
    await c.listActiveRestrictedItems({}, r);
    expect(prisma.tbl_restricted_item.findMany).toHaveBeenCalledWith({
      where: { status: true }, orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    });
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: true, data: [{ id: 1, name: "Explosives", description: "No" }] });
  });

  it("create requires a non-blank name", async () => {
    const r = res();
    await c.createRestrictedItem({ body: { name: "   " } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_restricted_item.create).not.toHaveBeenCalled();
  });

  it("create rejects a case-insensitive duplicate with 409", async () => {
    prisma.tbl_restricted_item.findFirst.mockResolvedValue({ id: 2, name: "Clothing" });
    const r = res();
    await c.createRestrictedItem({ body: { name: "clothing" } }, r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(prisma.tbl_restricted_item.create).not.toHaveBeenCalled();
  });

  it("create trims the name and stores it", async () => {
    prisma.tbl_restricted_item.findFirst.mockResolvedValue(null);
    prisma.tbl_restricted_item.create.mockResolvedValue({ id: 3, name: "Furniture" });
    const r = res();
    await c.createRestrictedItem({ body: { name: "  Furniture ", sort_order: "2" } }, r);
    expect(prisma.tbl_restricted_item.create).toHaveBeenCalledWith({ data: { name: "Furniture", description: null, sort_order: 2 } });
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it("update 404s for a missing type", async () => {
    prisma.tbl_restricted_item.findUnique.mockResolvedValue(null);
    const r = res();
    await c.updateRestrictedItem({ params: { id: "9" }, body: { name: "X" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });

  it("delete hard-deletes an unused type", async () => {
    prisma.tbl_restricted_item.findUnique.mockResolvedValue({ id: 6, name: "Unused" });
    const r = res();
    await c.deleteRestrictedItem({ params: { id: "6" } }, r);
    expect(prisma.tbl_restricted_item.delete).toHaveBeenCalledWith({ where: { id: 6 } });
  });
});
