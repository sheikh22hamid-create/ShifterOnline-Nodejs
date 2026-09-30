jest.mock("../../config/db", () => ({
  tbl_goods_type: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  pkg_order: { count: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
const prisma = require("../../config/db");
const c = require("../goodsTypeController");

function res() {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
}
beforeEach(() => jest.clearAllMocks());

describe("goodsTypeController", () => {
  it("customer list returns only active types ordered by sort_order then name", async () => {
    prisma.tbl_goods_type.findMany.mockResolvedValue([{ id: 1, name: "Clothing", status: true, sort_order: 0 }]);
    const r = res();
    await c.listActiveGoodsTypes({}, r);
    expect(prisma.tbl_goods_type.findMany).toHaveBeenCalledWith({
      where: { status: true }, orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    });
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: true, data: [{ id: 1, name: "Clothing" }] });
  });

  it("create requires a non-blank name", async () => {
    const r = res();
    await c.createGoodsType({ body: { name: "   " } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_goods_type.create).not.toHaveBeenCalled();
  });

  it("create rejects a case-insensitive duplicate with 409", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue({ id: 2, name: "Clothing" });
    const r = res();
    await c.createGoodsType({ body: { name: "clothing" } }, r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(prisma.tbl_goods_type.create).not.toHaveBeenCalled();
  });

  it("create trims the name and stores it", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue(null);
    prisma.tbl_goods_type.create.mockResolvedValue({ id: 3, name: "Furniture" });
    const r = res();
    await c.createGoodsType({ body: { name: "  Furniture ", sort_order: "2" } }, r);
    expect(prisma.tbl_goods_type.create).toHaveBeenCalledWith({ data: { name: "Furniture", sort_order: 2 } });
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it("update 404s for a missing type", async () => {
    prisma.tbl_goods_type.findUnique.mockResolvedValue(null);
    const r = res();
    await c.updateGoodsType({ params: { id: "9" }, body: { name: "X" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });

  it("delete soft-deletes a type that orders reference", async () => {
    prisma.tbl_goods_type.findUnique.mockResolvedValue({ id: 5, name: "Cement" });
    prisma.pkg_order.count.mockResolvedValue(3);
    const r = res();
    await c.deleteGoodsType({ params: { id: "5" } }, r);
    expect(prisma.tbl_goods_type.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: false } });
    expect(prisma.tbl_goods_type.delete).not.toHaveBeenCalled();
  });

  it("delete hard-deletes an unused type", async () => {
    prisma.tbl_goods_type.findUnique.mockResolvedValue({ id: 6, name: "Unused" });
    prisma.pkg_order.count.mockResolvedValue(0);
    const r = res();
    await c.deleteGoodsType({ params: { id: "6" } }, r);
    expect(prisma.tbl_goods_type.delete).toHaveBeenCalledWith({ where: { id: 6 } });
  });
});
