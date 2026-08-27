const bcrypt = require("bcryptjs");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { BCRYPT_SALT_ROUNDS, ADMIN_ROLES } = require("../config/constants");

async function attachCityNames(rows) {
  const cityIds = [...new Set(rows.map((r) => r.city_id).filter(Boolean))];
  if (cityIds.length === 0) return rows.map((r) => ({ ...r, city_name: null }));
  const cities = await prisma.tbl_city.findMany({ where: { id: { in: cityIds } }, select: { id: true, title: true } });
  const nameById = Object.fromEntries(cities.map((c) => [c.id, c.title]));
  return rows.map((r) => ({ ...r, city_name: r.city_id ? nameById[r.city_id] || null : null }));
}

function toPublicStaff(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    mobile: row.mobile,
    avatar: row.avatar,
    role: row.role,
    city_id: row.city_id,
    city_name: row.city_name,
    status: row.status,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
  };
}

async function list(req, res) {
  try {
    const where = {};

    if (req.user.role === "superadmin") {
      if (req.query.role) {
        if (!ADMIN_ROLES.includes(req.query.role)) {
          return res.status(400).json({ success: false, message: `role must be one of ${ADMIN_ROLES.join(", ")}` });
        }
        where.role = req.query.role;
      }
      if (req.query.city_id) where.city_id = parseInt(req.query.city_id, 10);
    } else {
      // City admins only ever see the executives assigned to their own city.
      where.role = "executive";
      where.city_id = parseInt(req.user.city_id, 10);
    }

    if (req.query.search) {
      where.OR = [{ username: { contains: req.query.search } }, { name: { contains: req.query.search } }];
    }

    const rows = await prisma.admin.findMany({ where, orderBy: { id: "asc" } });
    const withCity = await attachCityNames(rows);

    return res.status(200).json({ success: true, total: withCity.length, data: withCity.map(toPublicStaff) });
  } catch (err) {
    logger.error("staff list failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function create(req, res) {
  try {
    const actor = req.user;
    const { username, password, name, role, city_id, email, mobile } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ success: false, message: "username, password and role are required" });
    }
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `role must be one of ${ADMIN_ROLES.join(", ")}` });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "password must be at least 8 characters" });
    }

    let finalRole = role;
    let finalCityId = city_id ? parseInt(city_id, 10) : null;

    if (actor.role === "admin") {
      // City admins may only ever create executives, scoped to their own city.
      finalRole = "executive";
      finalCityId = parseInt(actor.city_id, 10);
    } else if (finalRole !== "superadmin" && !finalCityId) {
      return res.status(400).json({ success: false, message: "city_id is required for admin/executive accounts" });
    }

    if (finalCityId) {
      const city = await prisma.tbl_city.findUnique({ where: { id: finalCityId } });
      if (!city) {
        return res.status(400).json({ success: false, message: `city_id ${finalCityId} does not exist` });
      }
    }

    const existing = await prisma.admin.findFirst({ where: { username } });
    if (existing) {
      return res.status(409).json({ success: false, message: "username already in use" });
    }

    const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const created = await prisma.admin.create({
      data: {
        username,
        password: hash,
        name: name || null,
        email: email || null,
        mobile: mobile || null,
        role: finalRole,
        city_id: finalCityId,
        status: 1,
        created_by: actor.id,
      },
    });

    const [withCity] = await attachCityNames([created]);
    return res.status(201).json({ success: true, message: "Staff account created", data: toPublicStaff(withCity) });
  } catch (err) {
    logger.error("staff create failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function update(req, res) {
  try {
    const actor = req.user;
    const id = parseInt(req.params.id, 10);
    const target = await prisma.admin.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ success: false, message: "Staff account not found" });
    }

    if (actor.role === "admin" && (target.role !== "executive" || target.city_id !== parseInt(actor.city_id, 10))) {
      return res.status(403).json({ success: false, message: "Forbidden: can only update executives in your own city" });
    }

    const { name, email, mobile, status, city_id, role, password } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (mobile !== undefined) data.mobile = mobile;
    if (status !== undefined) data.status = status ? 1 : 0;

    if (actor.role === "superadmin") {
      if (role !== undefined) {
        if (!ADMIN_ROLES.includes(role)) {
          return res.status(400).json({ success: false, message: `role must be one of ${ADMIN_ROLES.join(", ")}` });
        }
        data.role = role;
      }
      if (city_id !== undefined) {
        const cid = city_id ? parseInt(city_id, 10) : null;
        if (cid) {
          const city = await prisma.tbl_city.findUnique({ where: { id: cid } });
          if (!city) return res.status(400).json({ success: false, message: `city_id ${cid} does not exist` });
        }
        data.city_id = cid;
      }
    }

    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ success: false, message: "password must be at least 8 characters" });
      }
      data.password = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    }

    const updated = await prisma.admin.update({ where: { id }, data });
    const [withCity] = await attachCityNames([updated]);
    return res.status(200).json({ success: true, message: "Staff account updated", data: toPublicStaff(withCity) });
  } catch (err) {
    logger.error("staff update failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account" });
    }
    const target = await prisma.admin.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ success: false, message: "Staff account not found" });
    }
    await prisma.admin.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Staff account deleted" });
  } catch (err) {
    logger.error("staff delete failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = { list, create, update, remove };
