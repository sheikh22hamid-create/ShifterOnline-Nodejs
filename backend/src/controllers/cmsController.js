const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

// ---------------------------------------------------------------------------
// Cancellation reasons (tbl_cancel_reason)
// ---------------------------------------------------------------------------

const CANCEL_REASON_TYPES = ["user", "driver", "both"];

async function listCancelReasons(req, res) {
  try {
    const where = {};
    if (req.query.type) {
      if (!CANCEL_REASON_TYPES.includes(req.query.type)) {
        return res.status(400).json({ success: false, message: `type must be one of ${CANCEL_REASON_TYPES.join(", ")}` });
      }
      where.type = req.query.type;
    }
    const rows = await prisma.tbl_cancel_reason.findMany({ where, orderBy: { id: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "cms.listCancelReasons");
  }
}

async function createCancelReason(req, res) {
  try {
    const { reason, type } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: "reason is required" });
    }
    if (type && !CANCEL_REASON_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of ${CANCEL_REASON_TYPES.join(", ")}` });
    }
    const created = await prisma.tbl_cancel_reason.create({ data: { reason, type: type || "both" } });
    return res.status(201).json({ success: true, message: "Cancellation reason created", data: created });
  } catch (err) {
    return internalError(res, err, "cms.createCancelReason");
  }
}

async function updateCancelReason(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_cancel_reason.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Cancellation reason not found" });
    }
    const { reason, type, status } = req.body;
    if (type && !CANCEL_REASON_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of ${CANCEL_REASON_TYPES.join(", ")}` });
    }
    const data = {};
    if (reason !== undefined) data.reason = reason;
    if (type !== undefined) data.type = type;
    if (status !== undefined) data.status = Boolean(status);
    const updated = await prisma.tbl_cancel_reason.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Cancellation reason updated", data: updated });
  } catch (err) {
    return internalError(res, err, "cms.updateCancelReason");
  }
}

async function deleteCancelReason(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_cancel_reason.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Cancellation reason not found" });
    }
    await prisma.tbl_cancel_reason.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Cancellation reason deleted" });
  } catch (err) {
    return internalError(res, err, "cms.deleteCancelReason");
  }
}

// ---------------------------------------------------------------------------
// Legal / static pages (tbl_page) — no slug column on the live schema, only
// id/title/status/description, so pages are addressed by id, not a slug.
// ---------------------------------------------------------------------------

async function listPages(req, res) {
  try {
    const rows = await prisma.tbl_page.findMany({ orderBy: { id: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "cms.listPages");
  }
}

async function createPage(req, res) {
  try {
    const { title, description, status } = req.body;
    if (!title || !description) {
      return res.status(400).json({ success: false, message: "title and description are required" });
    }
    const created = await prisma.tbl_page.create({ data: { title, description, status: status === undefined ? 1 : Number(status) } });
    return res.status(201).json({ success: true, message: "Page created", data: created });
  } catch (err) {
    return internalError(res, err, "cms.createPage");
  }
}

async function updatePage(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_page.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Page not found" });
    }
    const { title, description, status } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = Number(status);
    const updated = await prisma.tbl_page.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Page updated", data: updated });
  } catch (err) {
    return internalError(res, err, "cms.updatePage");
  }
}

async function deletePage(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_page.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Page not found" });
    }
    await prisma.tbl_page.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Page deleted" });
  } catch (err) {
    return internalError(res, err, "cms.deletePage");
  }
}

// ---------------------------------------------------------------------------
// FAQs (tbl_faq)
// ---------------------------------------------------------------------------

async function listFaqs(req, res) {
  try {
    const rows = await prisma.tbl_faq.findMany({ orderBy: { id: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "cms.listFaqs");
  }
}

async function createFaq(req, res) {
  try {
    const { question, answer, status } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ success: false, message: "question and answer are required" });
    }
    const created = await prisma.tbl_faq.create({ data: { question, answer, status: status === undefined ? 1 : Number(status) } });
    return res.status(201).json({ success: true, message: "FAQ created", data: created });
  } catch (err) {
    return internalError(res, err, "cms.createFaq");
  }
}

async function updateFaq(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_faq.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "FAQ not found" });
    }
    const { question, answer, status } = req.body;
    const data = {};
    if (question !== undefined) data.question = question;
    if (answer !== undefined) data.answer = answer;
    if (status !== undefined) data.status = Number(status);
    const updated = await prisma.tbl_faq.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "FAQ updated", data: updated });
  } catch (err) {
    return internalError(res, err, "cms.updateFaq");
  }
}

async function deleteFaq(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_faq.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "FAQ not found" });
    }
    await prisma.tbl_faq.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "FAQ deleted" });
  } catch (err) {
    return internalError(res, err, "cms.deleteFaq");
  }
}

module.exports = {
  listCancelReasons,
  createCancelReason,
  updateCancelReason,
  deleteCancelReason,
  listPages,
  createPage,
  updatePage,
  deletePage,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
};
