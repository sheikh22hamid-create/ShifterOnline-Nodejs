const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

const ORDER = [{ sort_order: "asc" }, { id: "asc" }];

async function listBookingGuidelines(req, res) {
  try {
    const rows = await prisma.tbl_booking_guideline.findMany({ orderBy: ORDER });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "bookingGuideline.list");
  }
}

// Customer app Confirm Booking page: active guidelines only.
async function listActiveBookingGuidelines(req, res) {
  try {
    const rows = await prisma.tbl_booking_guideline.findMany({ where: { status: true }, orderBy: ORDER });
    return res.status(200).json({ ResponseCode: "200", Result: true, data: rows.map((r) => ({ id: r.id, text: r.text })) });
  } catch (err) {
    logger.error("bookingGuideline.listActive failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: false, ResponseMsg: "Internal server error" });
  }
}

async function createBookingGuideline(req, res) {
  try {
    const text = String(req.body?.text ?? "").trim().slice(0, 255);
    if (!text) return res.status(400).json({ success: false, message: "text is required" });
    const sortOrder = Number.parseInt(req.body?.sort_order, 10);
    const created = await prisma.tbl_booking_guideline.create({
      data: { text, sort_order: Number.isFinite(sortOrder) ? sortOrder : 0 },
    });
    return res.status(201).json({ success: true, message: "Guideline created", data: created });
  } catch (err) {
    return internalError(res, err, "bookingGuideline.create");
  }
}

async function updateBookingGuideline(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_booking_guideline.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Guideline not found" });
    const data = {};
    if (req.body?.text !== undefined) {
      const text = String(req.body.text).trim().slice(0, 255);
      if (!text) return res.status(400).json({ success: false, message: "text cannot be blank" });
      data.text = text;
    }
    if (req.body?.status !== undefined) data.status = Boolean(req.body.status);
    if (req.body?.sort_order !== undefined) {
      const sortOrder = Number.parseInt(req.body.sort_order, 10);
      if (Number.isFinite(sortOrder)) data.sort_order = sortOrder;
    }
    const updated = await prisma.tbl_booking_guideline.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Guideline updated", data: updated });
  } catch (err) {
    return internalError(res, err, "bookingGuideline.update");
  }
}

async function deleteBookingGuideline(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_booking_guideline.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Guideline not found" });
    await prisma.tbl_booking_guideline.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Guideline deleted" });
  } catch (err) {
    return internalError(res, err, "bookingGuideline.delete");
  }
}

module.exports = {
  listBookingGuidelines,
  listActiveBookingGuidelines,
  createBookingGuideline,
  updateBookingGuideline,
  deleteBookingGuideline,
};
