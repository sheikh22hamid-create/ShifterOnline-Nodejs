const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { BCRYPT_SALT_ROUNDS } = require("../config/constants");

const BCRYPT_HASH_RE = /^\$2[aby]\$/;

async function getCityName(cityId) {
  if (!cityId) return null;
  const city = await prisma.tbl_city.findUnique({ where: { id: cityId }, select: { title: true } });
  return city ? city.title : null;
}

function toPublicAdmin(admin, cityName) {
  return {
    id: admin.id,
    username: admin.username,
    name: admin.name,
    email: admin.email,
    mobile: admin.mobile,
    avatar: admin.avatar,
    role: admin.role,
    city_id: admin.city_id,
    city_name: cityName,
    status: admin.status,
    permissions: admin.permissions,
    last_login_at: admin.last_login_at,
  };
}

async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "username and password are required" });
    }

    const admin = await prisma.admin.findFirst({ where: { username } });
    if (!admin) {
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }
    if (admin.status === 0) {
      return res.status(403).json({ success: false, message: "This account has been deactivated" });
    }

    // Legacy PHP-panel passwords are not bcrypt hashes — fail with a
    // distinct message instead of letting bcrypt.compare throw on them.
    const hasBcryptPassword = BCRYPT_HASH_RE.test(admin.password || "");
    const passwordMatches = hasBcryptPassword && (await bcrypt.compare(password, admin.password));
    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: hasBcryptPassword
          ? "Invalid username or password"
          : "This account's password hasn't been migrated yet — ask a super admin to reset it",
      });
    }

    const cityName = await getCityName(admin.city_id);
    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role, city_id: admin.city_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    await prisma.admin.update({ where: { id: admin.id }, data: { last_login_at: new Date() } });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: { token, user: toPublicAdmin(admin, cityName) },
    });
  } catch (err) {
    logger.error("admin login failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function me(req, res) {
  try {
    const admin = await prisma.admin.findUnique({ where: { id: req.user.id } });
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin account not found" });
    }
    const cityName = await getCityName(admin.city_id);
    return res.status(200).json({ success: true, data: toPublicAdmin(admin, cityName) });
  } catch (err) {
    logger.error("admin me failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function updateProfile(req, res) {
  try {
    const { name, email, mobile, current_password, new_password } = req.body;
    const admin = await prisma.admin.findUnique({ where: { id: req.user.id } });
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin account not found" });
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (mobile !== undefined) data.mobile = mobile;

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ success: false, message: "current_password is required to set a new password" });
      }
      const hasBcryptPassword = BCRYPT_HASH_RE.test(admin.password || "");
      const matches = hasBcryptPassword && (await bcrypt.compare(current_password, admin.password));
      if (!matches) {
        return res.status(401).json({ success: false, message: "Current password is incorrect" });
      }
      data.password = await bcrypt.hash(new_password, BCRYPT_SALT_ROUNDS);
    }

    const updated = await prisma.admin.update({ where: { id: admin.id }, data });
    const cityName = await getCityName(updated.city_id);

    return res.status(200).json({
      success: true,
      message: "Profile updated",
      data: toPublicAdmin(updated, cityName),
    });
  } catch (err) {
    logger.error("admin updateProfile failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = { login, me, updateProfile };
