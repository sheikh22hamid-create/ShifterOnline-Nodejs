const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

// ---------------------------------------------------------------------------
// Dynamic (survey) questions — tbl_question, with per-question answer choices
// in tbl_option (question_id FK, no declared Prisma relation on the live
// schema, so option counts/lookups are done with explicit where clauses).
// Mirrors the legacy admin's add_survey.php / list_survey_option.php.
// ---------------------------------------------------------------------------

const QUESTION_TYPES = ["Checkbox", "Radio"];

async function listQuestions(req, res) {
  try {
    const questions = await prisma.tbl_question.findMany({ orderBy: { id: "asc" } });
    const optionCounts = await prisma.tbl_option.groupBy({ by: ["question_id"], _count: { id: true } });
    const countByQuestionId = Object.fromEntries(optionCounts.map((row) => [row.question_id, row._count.id]));
    const data = questions.map((q) => ({ ...q, option_count: countByQuestionId[q.id] || 0 }));
    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "questions.listQuestions");
  }
}

async function createQuestion(req, res) {
  try {
    const { question, type, status } = req.body;
    if (!question) {
      return res.status(400).json({ success: false, message: "question is required" });
    }
    if (type && !QUESTION_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of ${QUESTION_TYPES.join(", ")}` });
    }
    const created = await prisma.tbl_question.create({
      data: { question, type: type || "Checkbox", status: status === undefined ? 1 : Number(status) },
    });
    return res.status(201).json({ success: true, message: "Question created", data: created });
  } catch (err) {
    return internalError(res, err, "questions.createQuestion");
  }
}

async function updateQuestion(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_question.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }
    const { question, type, status } = req.body;
    if (type && !QUESTION_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of ${QUESTION_TYPES.join(", ")}` });
    }
    const data = {};
    if (question !== undefined) data.question = question;
    if (type !== undefined) data.type = type;
    if (status !== undefined) data.status = Number(status);
    const updated = await prisma.tbl_question.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Question updated", data: updated });
  } catch (err) {
    return internalError(res, err, "questions.updateQuestion");
  }
}

async function deleteQuestion(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_question.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }
    // No FK/cascade on the live schema — clear the question's options first
    // so they don't become orphaned rows.
    await prisma.tbl_option.deleteMany({ where: { question_id: id } });
    await prisma.tbl_question.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Question deleted" });
  } catch (err) {
    return internalError(res, err, "questions.deleteQuestion");
  }
}

// ---------------------------------------------------------------------------
// Answer choices for Checkbox/Radio questions (tbl_option)
// ---------------------------------------------------------------------------

async function listOptions(req, res) {
  try {
    const questionId = parseInt(req.params.id, 10);
    const question = await prisma.tbl_question.findUnique({ where: { id: questionId } });
    if (!question) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }
    const rows = await prisma.tbl_option.findMany({ where: { question_id: questionId }, orderBy: { id: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "questions.listOptions");
  }
}

async function createOption(req, res) {
  try {
    const questionId = parseInt(req.params.id, 10);
    const question = await prisma.tbl_question.findUnique({ where: { id: questionId } });
    if (!question) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: "title is required" });
    }
    const created = await prisma.tbl_option.create({ data: { question_id: questionId, title, status: 1 } });
    return res.status(201).json({ success: true, message: "Option added", data: created });
  } catch (err) {
    return internalError(res, err, "questions.createOption");
  }
}

async function deleteOption(req, res) {
  try {
    const questionId = parseInt(req.params.id, 10);
    const optionId = parseInt(req.params.optionId, 10);
    const existing = await prisma.tbl_option.findFirst({ where: { id: optionId, question_id: questionId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Option not found" });
    }
    await prisma.tbl_option.delete({ where: { id: optionId } });
    return res.status(200).json({ success: true, message: "Option deleted" });
  } catch (err) {
    return internalError(res, err, "questions.deleteOption");
  }
}

module.exports = {
  listQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  listOptions,
  createOption,
  deleteOption,
};
