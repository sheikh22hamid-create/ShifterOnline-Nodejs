const crypto = require("crypto");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { uploadBuffer } = require("../utils/cloudinaryStorage");

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
async function updateProfileImage(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const img = req.body?.img;
    if (!uid || !img) return fail(res, "Something Went Wrong!");

    const base64 = String(img).replace(/^data:image\/\w+;base64,/, "").replace(/ /g, "+");
    const buffer = Buffer.from(base64, "base64");
    const relPath = await uploadBuffer(buffer, `images/profile/${crypto.randomUUID()}.png`);

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

// --- profile_overview --- (dynamic profile stats, completion %, quick access, etc.)
async function profileOverview(req, res) {
  try {
    const uid = Number(req.body?.uid || req.query?.uid || 0);
    if (!uid) return fail(res, "User ID is required!");

    const user = await prisma.tbl_user.findUnique({ where: { id: uid } });
    if (!user) return fail(res, "User Not Exist!!!!");

    // 1. Dynamic profile completion calculation
    const hasName = Boolean(user.name && user.name.trim().length > 0);
    const hasMobile = Boolean(user.mobile);
    const hasEmail = Boolean(user.email && user.email.trim().length > 0 && !user.email.includes("@placeholder"));
    const hasImage = Boolean(user.r_img && user.r_img.trim().length > 0 && user.r_img !== "null");
    
    // Check address count
    const addressCount = await prisma.tbl_address.count({ where: { uid } });
    const hasAddress = addressCount > 0;

    // Weighting: 5 items, 20% each
    const completedItems = [hasName, hasMobile, hasEmail, hasImage, hasAddress].filter(Boolean).length;
    const completionPercent = Math.min(100, completedItems * 20);

    let completionPrompt = "Add your email and more details for a better experience.";
    if (!hasEmail) {
      completionPrompt = "Add your email and more details for a better experience.";
    } else if (!hasImage) {
      completionPrompt = "Add your profile picture for a personalized experience.";
    } else if (!hasAddress) {
      completionPrompt = "Add your home and work address for 1-tap bookings.";
    } else if (completionPercent >= 100) {
      completionPrompt = "Your profile is 100% complete! Everything is up to date.";
    }

    // 2. Premium Plan Status
    const today = new Date();
    const activeSub = await prisma.tbl_user_plan_subscription.findFirst({
      where: {
        user_id: uid,
        plan_for: "USER",
        status: "active",
        end_date: { gte: today },
      },
      orderBy: { id: "desc" },
    });

    const premiumData = {
      is_premium: Boolean(activeSub),
      plan_name: activeSub?.plan_type || "Shifter Premium",
      badge: "NEW",
      title: "Shifter Premium",
      subtitle: activeSub 
        ? `Active Membership • Valid till ${activeSub.end_date.toISOString().split("T")[0]}`
        : "Save more on every booking\nFaster • Better • More rewards",
    };

    // 3. Favorite Drivers
    const favs = await prisma.tbl_favorite_driver.findMany({
      where: { user_id: uid, status: 1 },
      take: 5,
      orderBy: { id: "desc" },
    });
    const favRiderIds = favs.map((f) => f.rider_id).filter(Boolean);
    const riders = favRiderIds.length > 0 ? await prisma.tbl_rider.findMany({
      where: { id: { in: favRiderIds } },
      select: { id: true, first_name: true, last_name: true, profile_picture: true },
    }) : [];

    const favoriteDriversData = {
      title: "Favorite Drivers",
      subtitle: "Quickly book your preferred drivers",
      count: favRiderIds.length,
      drivers: riders.map((r) => ({
        id: r.id,
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        avatar: r.profile_picture || null,
      })),
    };

    // 4. Notifications unread count
    const notificationCount = await prisma.tbl_notification.count({ where: { uid } });

    // 5. App pages (FAQ, Privacy Policy, Terms)
    const pages = await prisma.tbl_page.findMany({ where: { status: 1 } });
    const privacyPage = pages.find((p) => p.title.toLowerCase().includes("privacy"));
    const termsPage = pages.find((p) => p.title.toLowerCase().includes("term") || p.title.toLowerCase().includes("condition"));

    // 6. Referral info
    const referralSetting = await prisma.tbl_referral_setting.findFirst();
    const referralCode = user.referral_code || user.refferal_code || "";
    const referralMsg = referralSetting?.share_message || "Hey! Use my referral code to sign up on Shifter Online and earn rewards!";

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Profile overview fetched successfully",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          mobile: String(user.mobile),
          ccode: user.ccode || "+91",
          r_img: user.r_img,
          wallet: user.wallet?.toString?.() ?? "0.00",
          is_phone_verified: true,
          is_verified: true,
          tagline: "Let's move a smarter, cleaner and more connected city.",
        },
        profile_completion: {
          percentage: completionPercent,
          title: "Complete your profile",
          prompt: completionPrompt,
          is_complete: completionPercent >= 100,
          missing_fields: [
            !hasEmail ? "email" : null,
            !hasImage ? "profile_image" : null,
            !hasAddress ? "saved_address" : null,
          ].filter(Boolean),
        },
        quick_access: {
          premium: premiumData,
          favorite_drivers: favoriteDriversData,
        },
        notifications: {
          unread_count: notificationCount,
          has_unread: notificationCount > 0,
        },
        legal: {
          privacy_policy: privacyPage ? { title: privacyPage.title, description: privacyPage.description } : null,
          terms_of_use: termsPage ? { title: termsPage.title, description: termsPage.description } : null,
        },
        referral: {
          code: referralCode,
          share_message: referralMsg,
        },
      },
    });
  } catch (err) {
    logger.error("customerProfileController.profileOverview failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

module.exports = { updateProfile, updateProfileImage, addressList, saveAddress, profileOverview };

