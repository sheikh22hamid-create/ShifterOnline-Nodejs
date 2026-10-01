const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function listRestrictedItems(req, res) {
  try {
    const rows = await prisma.tbl_restricted_item.findMany({ orderBy: [{ sort_order: "asc" }, { name: "asc" }] });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "restrictedItem.list");
  }
}

// Customer app picker: active types only.
async function listActiveRestrictedItems(req, res) {
  try {
    const rows = await prisma.tbl_restricted_item.findMany({
      where: { status: true }, orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    });
    return res.status(200).json({ ResponseCode: "200", Result: true, data: rows.map((r) => ({ id: r.id, name: r.name, description: r.description || "" })) });
  } catch (err) {
    logger.error("restrictedItem.listActive failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: false, ResponseMsg: "Internal server error" });
  }
}

async function nameTaken(name, exceptId) {
  // MySQL's default collation is case-insensitive, so a plain equality
  // match is a case-insensitive duplicate check.
  const found = await prisma.tbl_restricted_item.findFirst({ where: { name } });
  return Boolean(found && found.id !== exceptId);
}

async function createRestrictedItem(req, res) {
  try {
    const name = String(req.body?.name ?? "").trim().slice(0, 150);
    if (!name) return res.status(400).json({ success: false, message: "name is required" });
    if (await nameTaken(name)) return res.status(409).json({ success: false, message: "A restricted item with this name already exists" });
    const sortOrder = Number.parseInt(req.body?.sort_order, 10);
    const created = await prisma.tbl_restricted_item.create({
      data: { name, description: String(req.body?.description ?? "").trim().slice(0, 255) || null, sort_order: Number.isFinite(sortOrder) ? sortOrder : 0 },
    });
    return res.status(201).json({ success: true, message: "Restricted item created", data: created });
  } catch (err) {
    return internalError(res, err, "restrictedItem.create");
  }
}

async function updateRestrictedItem(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_restricted_item.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Restricted item not found" });
    const data = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 150);
      if (!name) return res.status(400).json({ success: false, message: "name cannot be blank" });
      if (await nameTaken(name, id)) return res.status(409).json({ success: false, message: "A restricted item with this name already exists" });
      data.name = name;
    }
    if (req.body?.description !== undefined) data.description = String(req.body.description ?? "").trim().slice(0, 255) || null;
    if (req.body?.status !== undefined) data.status = Boolean(req.body.status);
    if (req.body?.sort_order !== undefined) {
      const sortOrder = Number.parseInt(req.body.sort_order, 10);
      if (Number.isFinite(sortOrder)) data.sort_order = sortOrder;
    }
    const updated = await prisma.tbl_restricted_item.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Restricted item updated", data: updated });
  } catch (err) {
    return internalError(res, err, "restrictedItem.update");
  }
}

async function deleteRestrictedItem(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_restricted_item.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Restricted item not found" });
    await prisma.tbl_restricted_item.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Restricted item deleted" });
  } catch (err) {
    return internalError(res, err, "restrictedItem.delete");
  }
}

module.exports = { listRestrictedItems, listActiveRestrictedItems, createRestrictedItem, updateRestrictedItem, deleteRestrictedItem };
