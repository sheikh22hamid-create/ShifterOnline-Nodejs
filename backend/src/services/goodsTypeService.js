const prisma = require("../config/db");

const MAX_OTHER_LENGTH = 100;

function cleanOther(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().slice(0, MAX_OTHER_LENGTH);
  return text || null;
}

/**
 * Validates the optional goods-type inputs of a booking. Empty/0 id means
 * "no type chosen" (the field is optional); a non-empty id must reference an
 * active type, whose NAME is snapshotted so later renames/deletes never
 * change historical orders.
 */
async function resolveGoodsType({ goodsTypeId, goodsTypeOther } = {}) {
  const other = cleanOther(goodsTypeOther);
  const raw = goodsTypeId === undefined || goodsTypeId === null ? "" : String(goodsTypeId).trim();
  if (raw === "" || raw === "0") {
    return { ok: true, goods_type_id: null, goods_type_name: null, goods_type_other: other };
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 0) {
    return { ok: false, code: "INVALID_GOODS_TYPE", msg: "goods_type_id is not valid" };
  }
  const type = await prisma.tbl_goods_type.findFirst({ where: { id, status: true } });
  if (!type) {
    return { ok: false, code: "INVALID_GOODS_TYPE", msg: "Selected goods type is not available" };
  }
  return { ok: true, goods_type_id: type.id, goods_type_name: type.name, goods_type_other: other };
}

/** Single display string shown to drivers/admin; "" when the order has no goods info. */
function formatGoodsType(order) {
  const name = order?.goods_type_name ? String(order.goods_type_name).trim() : "";
  const other = order?.goods_type_other ? String(order.goods_type_other).trim() : "";
  if (name && other) return `${name} - ${other}`;
  if (name) return name;
  if (other) return `Other: ${other}`;
  return "";
}

module.exports = { resolveGoodsType, formatGoodsType };
