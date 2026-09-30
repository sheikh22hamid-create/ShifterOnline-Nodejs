jest.mock("../../config/db", () => ({ tbl_goods_type: { findFirst: jest.fn() } }));
const prisma = require("../../config/db");
const { resolveGoodsType, formatGoodsType } = require("../goodsTypeService");

beforeEach(() => jest.clearAllMocks());

describe("resolveGoodsType", () => {
  it("returns all-null when nothing is sent (field is optional)", async () => {
    for (const goodsTypeId of [undefined, null, "", 0, "0"]) {
      const r = await resolveGoodsType({ goodsTypeId, goodsTypeOther: undefined });
      expect(r).toEqual({ ok: true, goods_type_id: null, goods_type_name: null, goods_type_other: null });
    }
    expect(prisma.tbl_goods_type.findFirst).not.toHaveBeenCalled();
  });

  it("snapshots the name of an active type", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue({ id: 4, name: "Construction" });
    const r = await resolveGoodsType({ goodsTypeId: "4" });
    expect(prisma.tbl_goods_type.findFirst).toHaveBeenCalledWith({ where: { id: 4, status: true } });
    expect(r).toEqual({ ok: true, goods_type_id: 4, goods_type_name: "Construction", goods_type_other: null });
  });

  it("rejects an unknown or inactive id", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue(null);
    const r = await resolveGoodsType({ goodsTypeId: 99 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_GOODS_TYPE");
  });

  it("rejects a non-numeric id without hitting the database", async () => {
    const r = await resolveGoodsType({ goodsTypeId: "abc" });
    expect(r.ok).toBe(false);
    expect(prisma.tbl_goods_type.findFirst).not.toHaveBeenCalled();
  });

  it("trims Other text, turns whitespace-only into null, and caps at 100 chars", async () => {
    expect((await resolveGoodsType({ goodsTypeOther: "  Bricks  " })).goods_type_other).toBe("Bricks");
    expect((await resolveGoodsType({ goodsTypeOther: "   " })).goods_type_other).toBeNull();
    expect((await resolveGoodsType({ goodsTypeOther: "x".repeat(150) })).goods_type_other).toHaveLength(100);
  });

  it("keeps both the type and the Other text when both are sent", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue({ id: 4, name: "Construction" });
    const r = await resolveGoodsType({ goodsTypeId: 4, goodsTypeOther: "Tiles" });
    expect(r).toEqual({ ok: true, goods_type_id: 4, goods_type_name: "Construction", goods_type_other: "Tiles" });
  });
});

describe("formatGoodsType", () => {
  it("formats every combination", () => {
    expect(formatGoodsType({ goods_type_name: "Clothing" })).toBe("Clothing");
    expect(formatGoodsType({ goods_type_other: "Tiles" })).toBe("Other: Tiles");
    expect(formatGoodsType({ goods_type_name: "Clothing", goods_type_other: "Silk" })).toBe("Clothing - Silk");
    expect(formatGoodsType({})).toBe("");
    expect(formatGoodsType(null)).toBe("");
  });
});
