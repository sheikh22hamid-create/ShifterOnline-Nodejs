const prisma = require("../config/db");
const logger = require("../utils/logger");
const { assignDefaultDeliveryTypes } = require("../utils/assignDefaultDeliveryTypes");

// Node port of rider_api/document_check.php (onboarding-progress dashboard)
// and verify_driver_document.php (mark a document verified/rejected after
// the fact - e.g. once the app has itself called the DL/RC gov-verification
// proxies below and gotten a result). Neither calls any external service.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

// 0 = not submitted, 1 = pending, 2 = approved, 3 = rejected/other
function docStepStatus(hasIdValue, statusValue) {
  if (!hasIdValue) return 0;
  if (statusValue === 0) return 1;
  if (statusValue === 1) return 2;
  return 3;
}

// --- document_check.php ---
async function documentCheck(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    if (!riderId) return fail(res, "Something Went Wrong!");

    const [doc, contact, vehicle, bank, kit, rider, dynamicQ, vehicles, textAnswer] = await Promise.all([
      prisma.tbl_personal_doc.findFirst({ where: { rider_id: riderId } }),
      prisma.tbl_eme_contact.findFirst({ where: { rider_id: riderId } }),
      prisma.tbl_vehicle_details.findFirst({ where: { rider_id: riderId } }),
      prisma.tbl_bank_account.findFirst({ where: { rider_id: riderId } }),
      prisma.tbl_kit.findFirst({ where: { rider_id: riderId } }),
      prisma.tbl_rider.findUnique({ where: { id: riderId } }),
      prisma.tbl_dynamic.findFirst({ where: { id_status: 1 } }),
      prisma.tbl_vechicle.findMany({ where: { status: 1 } }),
      prisma.tbl_text_answer.findFirst({ where: { rider_id: riderId } }),
    ]);

    const personalDoc = docStepStatus(!!doc, doc?.status);
    const addressStatus = docStepStatus(!!doc?.address_id, doc?.address_status);
    const residenceStatus = docStepStatus(!!doc?.residence_id, doc?.residence_status);
    const licStatus = docStepStatus(!!doc?.lic_id, doc?.lic_status);
    const contactStatus = docStepStatus(!!contact, contact?.status);
    const vehicleStatus = docStepStatus(!!vehicle, vehicle?.status);
    const bankStatus = docStepStatus(!!bank, bank?.status);
    const kitStatus = docStepStatus(!!kit, kit?.kit_status);
    const surveyStatus = rider?.survey_status === 0 ? 0 : 2;
    const bycleStatus = doc?.is_bycle ? 1 : 0;
    const dynamicQStatus = docStepStatus(!!textAnswer, textAnswer?.id_status);
    const addInfo = rider?.add_info ?? 0;

    return res.status(200).json({
      vehicle_list: vehicles,
      dynamic_question: dynamicQ,
      bycle_status: bycleStatus,
      dynamic_question_status: dynamicQStatus,
      add_info: addInfo,
      personal_doc: personalDoc,
      address_status: addressStatus,
      residence_status: residenceStatus,
      lic_status: licStatus,
      contact_status: contactStatus,
      vehicle_status: vehicleStatus,
      bank_status: bankStatus,
      kit_status: kitStatus,
      survey_status: surveyStatus,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Document Status Get Successfully!!",
    });
  } catch (err) {
    logger.error("driverKycStatusController.documentCheck failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

const DOC_CONFIG = {
  aadhar: { idCol: "aadhar_id", statusCol: "aadhar_status", label: "Aadhar Card" },
  pan: { idCol: "pan_id", statusCol: "pan_status", label: "PAN Card" },
  rc: { idCol: "residence_id", statusCol: "residence_status", label: "Vehicle RC" },
  dl: { idCol: "lic_id", statusCol: "lic_status", label: "Driving License" },
  address: { idCol: "address_id", statusCol: "address_status", label: "Address Proof" },
};

function resolveDocKey(rawName) {
  const clean = String(rawName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean.includes("adhar") || clean.includes("aadhar") || clean.includes("aadhaar")) return "aadhar";
  if (clean.includes("pan")) return "pan";
  if (clean.includes("rc") || clean.includes("residence")) return "rc";
  if (clean.includes("dl") || clean.includes("lic") || clean.includes("license")) return "dl";
  if (clean.includes("address")) return "address";
  return clean;
}

function truthyFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1" || String(v).toLowerCase() === "approved";
}

function collectDocuments(body) {
  const docs = [];
  if (Array.isArray(body.documents)) {
    for (const d of body.documents) {
      const name = d.DocumentName || d.document_name || d.name || "";
      const number = d.DocumentNumber || d.document_number || d.number || "";
      const isVer = d.isVerified ?? d.is_verified ?? d.status ?? true;
      if (name) docs.push({ name: String(name), number: String(number), verified: truthyFlag(isVer) });
    }
  }
  if (!docs.length && (body.DocumentName || body.document_name)) {
    const name = body.DocumentName || body.document_name;
    const number = body.DocumentNumber || body.document_number || "";
    const isVer = body.isVerified ?? body.is_verified ?? body.status ?? true;
    docs.push({ name: String(name), number: String(number), verified: truthyFlag(isVer) });
  }
  if (!docs.length) {
    const flat = [
      ["Aadhar", ["aadhar_no", "aadhar_number"], "aadhar_verified"],
      ["Pan", ["pan_no", "pan_number"], "pan_verified"],
      ["Rc", ["rc_no", "rc_number", "residence_no"], "rc_verified"],
      ["Dl", ["dl_no", "dl_number", "license_no"], "dl_verified"],
    ];
    for (const [label, numberKeys, verifiedKey] of flat) {
      const number = numberKeys.map((k) => body[k]).find((v) => v);
      if (number) {
        const verifiedRaw = body[verifiedKey];
        const verified = verifiedRaw === undefined || truthyFlag(verifiedRaw);
        docs.push({ name: label, number: String(number), verified });
      }
    }
  }
  return docs;
}

// --- verify_driver_document.php --- (single, batch, or flat-key document verification)
async function verifyDriverDocument(req, res) {
  try {
    const body = req.body || {};
    let riderId = Number(body.rider_id || 0);
    const mobile = String(body.mobile || "").trim();
    let cityId = Number(body.city_id || 0);

    if (!riderId && !mobile) return fail(res, "Either 'rider_id' or 'mobile' is required.");

    if (!riderId && mobile) {
      const existing = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
      if (existing) {
        riderId = existing.id;
        if (!cityId && existing.city_id) cityId = existing.city_id;
      } else {
        const created = await prisma.tbl_rider.create({
          data: {
            full_name: "",
            email: "",
            password: "",
            fmobile: mobile,
            vehicle: "",
            vehicle_no: "",
            account_name: "",
            account_number: "",
            ifsc: "",
            city_id: cityId > 0 ? cityId : 1,
            rdate: new Date(),
            verification_type: "manual",
            verification_status: "pending",
            all_verify: 0,
            a_status: 0,
            status: 1,
            profile_picture: "",
            fcm_token: "",
            device_id: "",
          },
        });
        riderId = created.id;
      }
    }
    if (!riderId) return fail(res, "Invalid driver identifier.");
    if (cityId > 0) await prisma.tbl_rider.update({ where: { id: riderId }, data: { city_id: cityId } });

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { fmobile: true } });

    const documents = collectDocuments(body);
    if (!documents.length) return fail(res, "No valid document details found in request.");

    let docRow = await prisma.tbl_personal_doc.findFirst({ where: { rider_id: riderId } });
    if (!docRow) docRow = await prisma.tbl_personal_doc.create({ data: { rider_id: riderId, status: 0 } });

    const update = {};
    const summary = [];
    for (const doc of documents) {
      const resolved = resolveDocKey(doc.name);
      const cfg = DOC_CONFIG[resolved];
      if (!cfg) {
        summary.push({ document: doc.name, status: "Skipped (Unknown document type)", success: false });
        continue;
      }
      if (doc.number) update[cfg.idCol] = doc.number;
      update[cfg.statusCol] = doc.verified ? 1 : 2; // 1 = Approved, 2 = Rejected
      summary.push({ document: cfg.label, document_number: doc.number, status: doc.verified ? "Approved" : "Rejected", is_verified: doc.verified });
    }
    if (Object.keys(update).length) {
      await prisma.tbl_personal_doc.update({ where: { id: docRow.id }, data: update });
    }

    const finalDoc = await prisma.tbl_personal_doc.findUnique({ where: { id: docRow.id } });
    const isBicycle = finalDoc?.is_bycle === 1;
    const aadharApproved = finalDoc?.aadhar_status === 1;
    const panApproved = finalDoc?.pan_status === 1;
    const residenceApproved = finalDoc?.residence_status === 1;
    const licApproved = finalDoc?.lic_status === 1;
    const isAllVerified = isBicycle
      ? residenceApproved && (aadharApproved || panApproved)
      : aadharApproved && panApproved && residenceApproved && licApproved;

    if (isAllVerified) {
      await prisma.tbl_personal_doc.update({ where: { id: docRow.id }, data: { status: 1 } });
      await prisma.tbl_rider.update({
        where: { id: riderId },
        data: { verification_status: "approved", all_verify: 1, a_status: 1, status: 1 },
      });
      await assignDefaultDeliveryTypes(riderId);
    }

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: isAllVerified ? "All documents verified and Driver profile approved successfully!" : "Document(s) verification status updated successfully.",
      is_all_verified: isAllVerified,
      rider_id: String(riderId),
      mobile: String(rider?.fmobile || mobile),
      verified_documents: summary,
    });
  } catch (err) {
    logger.error("driverKycStatusController.verifyDriverDocument failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: `Server Error: ${err.message}` });
  }
}

module.exports = { documentCheck, verifyDriverDocument };
