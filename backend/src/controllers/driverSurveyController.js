const multer = require("multer");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { uploadBuffer } = require("../utils/cloudinaryStorage");

// Node port of rider_api/rider_dynamic_question.php, dy_answer.php,
// survey_list.php, survery_answer.php.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

// --- rider_dynamic_question.php ---
async function dynamicQuestionList(req, res) {
  try {
    const rows = await prisma.tbl_dynamic.findMany({ where: { id_status: 1 } });
    return res.status(200).json({ data: rows, ResponseCode: "200", Result: "true", ResponseMsg: "Dynamic Question  Founded!" });
  } catch (err) {
    logger.error("driverSurveyController.dynamicQuestionList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- dy_answer.php --- (type: "Text" | "File" | "Both")
async function saveFiles(files) {
  return Promise.all(
    files.map((file) => {
      const filename = `${Date.now()}${Math.floor(Math.random() * 1e6)}.jpg`;
      return uploadBuffer(file.buffer, `images/dynamic/${filename}`);
    })
  );
}

const dyAnswerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).any();

function saveDynamicAnswer(req, res) {
  dyAnswerUpload(req, res, async (err) => {
    if (err) {
      logger.error("driverSurveyController.saveDynamicAnswer upload failed:", err);
      return fail(res, err.message || "Upload failed", 400);
    }
    try {
      const b = req.body || {};
      const riderId = Number(b.rider_id || 0);
      const type = b.type; // "Text" | "File" | "Both"
      const idNum = b.id_num;
      if (!riderId || !type) return fail(res, "Something Went Wrong!");

      let frontJoined = "";
      let backJoined = "";
      if (type === "File" || type === "Both") {
        const files = req.files || [];
        const frontPaths = await saveFiles(files.filter((f) => /^image\d+$/.test(f.fieldname)));
        const backPaths = await saveFiles(files.filter((f) => /^images\d+$/.test(f.fieldname)));
        if (!frontPaths.length || !backPaths.length) return fail(res, "Question Back Or Front Sent Null Please Check!!");
        frontJoined = frontPaths.join("$;");
        backJoined = backPaths.join("$;");
      }

      const dynamicId = 1;
      const data = { dynamic_id: dynamicId, id_status: 0 };
      if (type === "Both") {
        Object.assign(data, { id_front: frontJoined, id_back: backJoined, id_num: idNum });
      } else if (type === "File") {
        Object.assign(data, { id_front: frontJoined, id_back: backJoined });
      } else {
        Object.assign(data, { id_num: idNum });
      }

      const existing = await prisma.tbl_text_answer.findFirst({ where: { rider_id: riderId } });
      if (existing) {
        await prisma.tbl_text_answer.update({ where: { id: existing.id }, data });
      } else {
        await prisma.tbl_text_answer.create({ data: { rider_id: riderId, ...data } });
      }
      await prisma.tbl_rider.update({ where: { id: riderId }, data: { add_info: 1 } });

      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: existing ? "Details Update Successfully!!" : "Details Add Successfully!!" });
    } catch (e) {
      logger.error("driverSurveyController.saveDynamicAnswer failed:", e);
      return fail(res, "Internal server error", 500);
    }
  });
}

// --- survey_list.php ---
async function surveyList(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    if (!riderId) return fail(res, "Something Went Wrong!");

    const questions = await prisma.tbl_question.findMany({ where: { status: 1 } });
    const result = [];
    for (const q of questions) {
      const options = await prisma.tbl_option.findMany({ where: { question_id: q.id, status: 1 } });
      if (!options.length) continue;
      result.push({
        question_title: q.question,
        question_type: q.type,
        option_data: options.map((o) => ({ option_id: o.id, question_id: o.question_id, option_title: o.title })),
      });
    }

    return res.status(200).json({
      SurveryList: result,
      totalquestion: questions.length,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Survey Details Get Successfully!!",
    });
  } catch (err) {
    logger.error("driverSurveyController.surveyList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- survery_answer.php ---
async function saveSurveyAnswers(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    const surveyData = req.body?.surveydata;
    if (!riderId || !Array.isArray(surveyData) || !surveyData.length) return fail(res, "Something Went Wrong!");

    await prisma.tbl_survery_answer.createMany({
      data: surveyData.map((s) => ({
        rider_id: riderId,
        question_text: String(s.question_text || ""),
        answer_text: String(s.answer_text || ""),
      })),
    });
    await prisma.tbl_rider.update({ where: { id: riderId }, data: { survey_status: 1 } });

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Survey Answer Saved Successfully!!" });
  } catch (err) {
    logger.error("driverSurveyController.saveSurveyAnswers failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

module.exports = { dynamicQuestionList, saveDynamicAnswer, surveyList, saveSurveyAnswers };
