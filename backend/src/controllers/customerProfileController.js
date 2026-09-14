const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const prisma = require("../config/db");
const logger = require("../utils/logger");

// Node port of cust_api/profile.php, pro_image.php, address_list.php,
// address_user.php. Same { Result, ResponseCode, ResponseMsg } shape as the
// PHP originals.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

function serializeUser(user) {
  if (!user) return user;
  return { ...user, wallet: user.wallet?.toString?.() ?? user.wallet };
}

// --- profile.php ---
// The PHP version's update field list included a non-existent `lname`
// column (tbl_user has no such column) and silently skipped `mobile` even
// though it validated mobile-uniqueness first. Fixed here: only real
// columns are written (name/email/password), and mobile is updated too
// since it was already checked for collisions.
async function updateProfile(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const fname = String(req.body?.fname || "").trim();
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "").trim();
    const mobile = req.body?.mobile !== undefined ? String(req.body.mobile).trim() : "";
    if (!uid || !fname || !email || !password) return fail(res, "Something Went Wrong!");

    const user = await prisma.tbl_user.findUnique({ where: { id: uid } });
    if (!user) return fail(res, "User Not Exist!!!!");

    if (mobile) {
      const mobileTaken = await prisma.tbl_user.findFirst({
        where: { id: { not: uid }, mobile: Number(mobile) },
      });
      if (mobileTaken) return fail(res, "This Mobile Number Already Used!!");
    }

    const data = { name: fname, email, password };
    if (mobile) data.mobile = Number(mobile);

    const updated = await prisma.tbl_user.update({ where: { id: uid }, data });
    return res.status(200).json({ UserLogin: serializeUser(updated), ResponseCode: "200", Result: "true", ResponseMsg: "Profile Update successfully!" });
  } catch (err) {
    logger.error("customerProfileController.updateProfile failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- pro_image.php ---
const PROFILE_IMG_DIR = path.join(__dirname, "..", "..", "public", "images", "profile");
fs.mkdirSync(PROFILE_IMG_DIR, { recursive: true });

async function updateProfileImage(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const img = req.body?.img;
    if (!uid || !img) return fail(res, "Something Went Wrong!");

    const base64 = String(img).replace(/^data:image\/\w+;base64,/, "").replace(/ /g, "+");
    const buffer = Buffer.from(base64, "base64");
    const filename = `${crypto.randomUUID()}.png`;
    fs.writeFileSync(path.join(PROFILE_IMG_DIR, filename), buffer);
    const relPath = `images/profile/${filename}`;

    const updated = await prisma.tbl_user.update({ where: { id: uid }, data: { r_img: relPath } });
    return res.status(200).json({ UserLogin: serializeUser(updated), ResponseCode: "200", Result: "true", ResponseMsg: "Profile Image Upload Successfully!!" });
  } catch (err) {
    logger.error("customerProfileController.updateProfileImage failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

function mapAddress(a) {
  return {
    id: a.id,
    uid: a.uid,
    hno: a.houseno,
    address: a.address,
    c_name: a.c_name,
    c_number: a.c_number,
    lat_map: a.lat_map,
    long_map: a.long_map,
    landmark: a.landmark,
    type: a.type,
    is_tracking: a.is_tracking,
  };
}

// --- address_list.php ---
async function addressList(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    if (!uid) return fail(res, "Something Went wrong  try again !");

    const rows = await prisma.tbl_address.findMany({ where: { uid }, orderBy: { id: "desc" } });
    if (!rows.length) return fail(res, "Address List Not Found!!");

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Address List Get Successfully!!!", AddressList: rows.map(mapAddress) });
  } catch (err) {
    logger.error("customerProfileController.addressList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- address_user.php --- (aid=0 -> insert, else update)
async function saveAddress(req, res) {
  try {
    const b = req.body || {};
    const uid = Number(b.uid || 0);
    const aid = Number(b.aid ?? -1);
    if (!uid || !b.address || !b.type || !b.lat_map || !b.long_map || b.aid === undefined || b.aid === null || b.aid === "") {
      return fail(res, "Something Went Wrong!");
    }

    const activeUser = await prisma.tbl_user.findFirst({ where: { id: uid, status: 1 } });
    if (!activeUser) return fail(res, "User Either Not Exit OR Deactivated From Admin!");

    const fields = {
      address: b.address || null,
      houseno: b.houseno || null,
      landmark: b.landmark || null,
      type: b.type || null,
      lat_map: b.lat_map || null,
      long_map: b.long_map || null,
      c_name: b.c_name || null,
      c_number: b.c_number || null,
      is_tracking: b.is_tracking ? Number(b.is_tracking) : null,
    };

    if (aid === 0) {
      await prisma.tbl_address.create({ data: { uid, ...fields } });
      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Address Saved Successfully!!!" });
    }

    await prisma.tbl_address.updateMany({ where: { id: aid, uid }, data: fields });
    const updated = await prisma.tbl_address.findUnique({ where: { id: aid } });
    return res.status(200).json({ AddressData: updated ? mapAddress(updated) : null, ResponseCode: "200", Result: "true", ResponseMsg: "Address Updated Successfully!!!" });
  } catch (err) {
    logger.error("customerProfileController.saveAddress failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

module.exports = { updateProfile, updateProfileImage, addressList, saveAddress };
