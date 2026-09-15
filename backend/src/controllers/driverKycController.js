const multer = require("multer");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { uploadBuffer } = require("../utils/cloudinaryStorage");

// Node port of rider_api/address_document.php, license_document.php,
// residence_document.php, bank_account.php, vehicle_detail_save.php,
// rider_vehicle_update.php, vehicle_type.php, tbl_vehicle_list.php.
//
// The three *_document.php originals were near-duplicates with real bugs:
// the "back" image loop wrote into the SAME array as the "front" loop
// (`$v[] = ...` in both places instead of `$vs[]` for the second one), and
// residence_document.php referenced an undefined `$data`/`$fnames`/`$datap`
// (dead code that would warning-and-no-op, not fix anything). Consolidated
// into one correct generic handler here instead of copy-pasting the bug
// three times.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

// PHP took N front images as image0..imageN-1 and N back images as
// images0..imagesN-1 (multipart form fields), joining each side's saved
// paths with '$;'. Kept identical here so the driver app's existing upload
// code needs no changes.
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).any();

async function saveFilesToFolder(files, folder) {
  return Promise.all(
    files.map((file) => {
      const filename = `${Date.now()}${Math.floor(Math.random() * 1e6)}.jpg`;
      return uploadBuffer(file.buffer, `images/${folder}/${filename}`);
    })
  );
}

// docType: { folder, idField, frontField, backField, statusField, missingMsg, successUpdateMsg, successInsertMsg }
const DOC_TYPES = {
  address: {
    folder: "address",
    idField: "address_id",
    frontField: "address_front",
    backField: "address_back",
    statusField: "address_status",
    missingMsg: "Address Back Or Front Sent Null Please Check!!",
    successUpdateMsg: "Address Details Update Successfully!!",
    successInsertMsg: "Address Details Add Successfully!!",
  },
  license: {
    folder: "license",
    idField: "lic_id",
    frontField: "lic_front",
    backField: "lic_back",
    statusField: "lic_status",
    missingMsg: "License Back Or Front Sent Null Please Check!!",
    successUpdateMsg: "License Details Update Successfully!!",
    successInsertMsg: "License Details Add Successfully!!",
  },
  residence: {
    folder: "residence",
    idField: "residence_id",
    frontField: "residence_front",
    backField: "residence_back",
    statusField: "residence_status",
    missingMsg: "Residence Back Or Front Sent Null Please Check!!",
    successUpdateMsg: "Residence Details Update Successfully!!",
    successInsertMsg: "Residence Details Add Successfully!!",
  },
};

function uploadDocumentHandler(docType) {
  const cfg = DOC_TYPES[docType];
  return function handler(req, res) {
    docUpload(req, res, async (err) => {
      if (err) {
        logger.error(`driverKycController.uploadDocument(${docType}) upload failed:`, err);
        return fail(res, err.message || "Upload failed", 400);
      }
      try {
        const b = req.body || {};
        const docId = b[cfg.idField];
        const riderId = Number(b.rider_id || 0);
        if (!docId || !riderId) return fail(res, "Something Went Wrong!");

        const files = req.files || [];
        const frontFiles = files.filter((f) => /^image\d+$/.test(f.fieldname));
        const backFiles = files.filter((f) => /^images\d+$/.test(f.fieldname));
        const frontPaths = await saveFilesToFolder(frontFiles, cfg.folder);
        const backPaths = await saveFilesToFolder(backFiles, cfg.folder);
        if (!frontPaths.length || !backPaths.length) return fail(res, cfg.missingMsg);

        const frontJoined = frontPaths.join("$;");
        const backJoined = backPaths.join("$;");

        const existing = await prisma.tbl_personal_doc.findFirst({ where: { rider_id: riderId } });
        const data = {
          [cfg.idField]: String(docId),
          [cfg.frontField]: frontJoined,
          [cfg.backField]: backJoined,
          [cfg.statusField]: 0,
        };

        if (existing) {
          await prisma.tbl_personal_doc.update({ where: { id: existing.id }, data });
          return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: cfg.successUpdateMsg });
        }

        await prisma.tbl_personal_doc.create({ data: { rider_id: riderId, ...data } });
        return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: cfg.successInsertMsg });
      } catch (e) {
        logger.error(`driverKycController.uploadDocument(${docType}) failed:`, e);
        return fail(res, "Internal server error", 500);
      }
    });
  };
}

const uploadAddressDocument = uploadDocumentHandler("address");
const uploadLicenseDocument = uploadDocumentHandler("license");
const uploadResidenceDocument = uploadDocumentHandler("residence");

// --- bank_account.php --- (BankAccountActivity's fields) and a second,
// older screen (AccountActivity) that collects a different field set for
// the same table - a_name/iban_num/vat_id, no IFSC/branch. Both map onto
// tbl_bank_account fine: ifsc_code/branch_name are nullable in the schema,
// so they're only required when the caller actually sends account__name
// (BankAccountActivity's flow); AccountActivity's a_name/iban_num flow
// only requires the fields its screen actually collects.
async function saveBankAccount(req, res) {
  try {
    const b = req.body || {};
    const riderId = Number(b.rider_id || 0);
    const accountName = b.account__name || b.a_name;
    const accountNumber = b.account_number || b.iban_num;
    const ifscCode = b.ifsc_code || "";
    const bankName = b.bank_name;
    const branchName = b.branch_name || "";
    const vatId = b.vat_id || "";
    const requiresIfscAndBranch = !!b.account__name; // BankAccountActivity's flow collects these; AccountActivity's doesn't
    if (!riderId || !accountName || !accountNumber || !bankName || (requiresIfscAndBranch && (!ifscCode || !branchName))) {
      return fail(res, "Missing Parameters!");
    }

    const existing = await prisma.tbl_bank_account.findFirst({ where: { rider_id: riderId } });
    if (existing) {
      await prisma.tbl_bank_account.update({
        where: { id: existing.id },
        data: {
          a_name: accountName,
          iban_num: accountNumber,
          // Don't blank out a previously-saved IFSC/branch/VAT just because
          // this particular caller's screen doesn't collect that field.
          ifsc_code: ifscCode || existing.ifsc_code,
          bank_name: bankName,
          branch_name: branchName || existing.branch_name,
          vat_id: vatId || existing.vat_id,
          status: 0,
        },
      });
      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Bank Details Updated Successfully!" });
    }

    await prisma.tbl_bank_account.create({
      data: {
        rider_id: riderId,
        a_name: accountName,
        iban_num: accountNumber,
        ifsc_code: ifscCode,
        bank_name: bankName,
        branch_name: branchName,
        vat_id: vatId,
      },
    });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Bank Details Added Successfully!" });
  } catch (err) {
    logger.error("driverKycController.saveBankAccount failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- vehicle_detail_save.php --- (single-photo field per PHP's image0..N convention)
const vehicleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).any();

function handleVehicleDetailSave(req, res) {
  vehicleUpload(req, res, async (err) => {
    if (err) {
      logger.error("driverKycController.saveVehicleDetail upload failed:", err);
      return fail(res, err.message || "Upload failed", 400);
    }
    try {
      const b = req.body || {};
      const typeId = Number(b.type_id || 0);
      const regNum = b.reg_num;
      const riderId = Number(b.rider_id || 0);
      if (!typeId || !regNum || !riderId) return fail(res, "Something Went Wrong!");

      const files = (req.files || []).filter((f) => /^image\d+$/.test(f.fieldname));
      const paths = await saveFilesToFolder(files, "vehicle");
      if (!paths.length) return fail(res, "Vehicle Image Sent Null Please Check!!");
      const joined = paths.join("$;");

      const existing = await prisma.tbl_vehicle_details.findFirst({ where: { rider_id: riderId } });
      if (existing) {
        await prisma.tbl_vehicle_details.update({
          where: { id: existing.id },
          data: { type_id: typeId, v_pic: joined, reg_num: regNum, status: 0 },
        });
        return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Vehicle Details Update Successfully!!" });
      }

      await prisma.tbl_vehicle_details.create({ data: { rider_id: riderId, type_id: typeId, v_pic: joined, reg_num: regNum } });
      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Vehicle Details Add Successfully!!" });
    } catch (e) {
      logger.error("driverKycController.saveVehicleDetail failed:", e);
      return fail(res, "Internal server error", 500);
    }
  });
}

// --- rider_vehicle_update.php --- (just changes tbl_rider.vehicle category)
async function updateRiderVehicle(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    const vehicleType = String(req.body?.vehicle_type || "").trim();
    if (!riderId || !vehicleType) return res.status(200).json({ Result: false, msg: "Invalid Data" });

    const result = await prisma.tbl_rider.updateMany({ where: { id: riderId }, data: { vehicle: vehicleType } });
    if (result.count === 1) {
      return res.status(200).json({ Result: true, msg: "Vehicle Details Updated Successfully" });
    }
    return res.status(200).json({ Result: false, msg: "Update Failed or No Changes" });
  } catch (err) {
    logger.error("driverKycController.updateRiderVehicle failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

// --- vehicle_type.php --- (banner + active package categories, used on the driver vehicle-type picker)
async function vehicleTypeList(req, res) {
  try {
    const banners = await prisma.tbl_banner.findMany({ where: { status: 1 } });
    const categories = await prisma.pkg_category.findMany({ where: { cat_status: 1 } });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResultData: categories, banner: banners.map((b) => ({ id: b.id, img: b.img })) });
  } catch (err) {
    logger.error("driverKycController.vehicleTypeList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- tbl_vehicle_list.php ---
async function vehicleList(req, res) {
  try {
    const rows = await prisma.tbl_vechicle.findMany({ where: { status: 1 } });
    return res.status(200).json({ data: rows, ResponseCode: "200", Result: "true", ResponseMsg: "Vehicle List Founded!" });
  } catch (err) {
    logger.error("driverKycController.vehicleList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

module.exports = {
  uploadAddressDocument,
  uploadLicenseDocument,
  uploadResidenceDocument,
  saveBankAccount,
  saveVehicleDetail: handleVehicleDetailSave,
  updateRiderVehicle,
  vehicleTypeList,
  vehicleList,
};
