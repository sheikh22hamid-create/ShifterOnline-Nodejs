const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function listGoodsTypes(req, res) {
  try {
    const rows = await prisma.tbl_goods_type.findMany({ orderBy: [{ sort_order: "asc" }, { name: "asc" }] });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "goodsType.list");
  }
}

// Customer app picker: active types only.
async function listActiveGoodsTypes(req, res) {
  try {
    const rows = await prisma.tbl_goods_type.findMany({
      where: { status: true }, orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    });
    return res.status(200).json({ ResponseCode: "200", Result: true, data: rows.map((r) => ({ id: r.id, name: r.name })) });
  } catch (err) {
    logger.error("goodsType.listActive failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: false, ResponseMsg: "Internal server error" });
  }
}

async function nameTaken(name, exceptId) {
  // MySQL's default collation is case-insensitive, so a plain equality
  // match is a case-insensitive duplicate check.
  const found = await prisma.tbl_goods_type.findFirst({ where: { name } });
  return Boolean(found && found.id !== exceptId);
}

async function createGoodsType(req, res) {
  try {
    const name = String(req.body?.name ?? "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ success: false, message: "name is required" });
    if (await nameTaken(name)) return res.status(409).json({ success: false, message: "A goods type with this name already exists" });
    const sortOrder = Number.parseInt(req.body?.sort_order, 10);
    const created = await prisma.tbl_goods_type.create({
      data: { name, sort_order: Number.isFinite(sortOrder) ? sortOrder : 0 },
    });
    return res.status(201).json({ success: true, message: "Goods type created", data: created });
  } catch (err) {
    return internalError(res, err, "goodsType.create");
  }
}

async function updateGoodsType(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_goods_type.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Goods type not found" });
    const data = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 100);
      if (!name) return res.status(400).json({ success: false, message: "name cannot be blank" });
      if (await nameTaken(name, id)) return res.status(409).json({ success: false, message: "A goods type with this name already exists" });
      data.name = name;
    }
    if (req.body?.status !== undefined) data.status = Boolean(req.body.status);
    if (req.body?.sort_order !== undefined) {
      const sortOrder = Number.parseInt(req.body.sort_order, 10);
      if (Number.isFinite(sortOrder)) data.sort_order = sortOrder;
    }
    const updated = await prisma.tbl_goods_type.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Goods type updated", data: updated });
  } catch (err) {
    return internalError(res, err, "goodsType.update");
  }
}

async function deleteGoodsType(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_goods_type.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Goods type not found" });
    const used = await prisma.pkg_order.count({ where: { goods_type_id: id } });
    if (used > 0) {
      // Old orders keep their name snapshot; just hide the type from new bookings.
      await prisma.tbl_goods_type.update({ where: { id }, data: { status: false } });
      return res.status(200).json({ success: true, message: "Goods type is used by existing orders, so it was deactivated instead of deleted" });
    }
    await prisma.tbl_goods_type.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Goods type deleted" });
  } catch (err) {
    return internalError(res, err, "goodsType.delete");
  }
}

module.exports = { listGoodsTypes, listActiveGoodsTypes, createGoodsType, updateGoodsType, deleteGoodsType };
