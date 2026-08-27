const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

// ---------------------------------------------------------------------------
// Banners (tbl_banner)
// ---------------------------------------------------------------------------

async function listBanners(req, res) {
  try {
    const where = {};
    if (req.query.city_id) where.city_id = parseInt(req.query.city_id, 10);
    const rows = await prisma.tbl_banner.findMany({ where, orderBy: { id: "desc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "marketing.listBanners");
  }
}

async function createBanner(req, res) {
  try {
    const { img, city_id, status } = req.body;
    if (!img || !city_id) {
      return res.status(400).json({ success: false, message: "img and city_id are required" });
    }
    if (req.user.role === "admin" && parseInt(city_id, 10) !== parseInt(req.user.city_id, 10)) {
      return res.status(403).json({ success: false, message: "Forbidden: can only create banners for your own city" });
    }
    const created = await prisma.tbl_banner.create({ data: { img, city_id: parseInt(city_id, 10), status: status === undefined ? 1 : Number(status) } });
    return res.status(201).json({ success: true, message: "Banner created", data: created });
  } catch (err) {
    return internalError(res, err, "marketing.createBanner");
  }
}

async function updateBanner(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_banner.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }
    if (req.user.role === "admin" && existing.city_id !== parseInt(req.user.city_id, 10)) {
      return res.status(403).json({ success: false, message: "Forbidden: banner is outside your assigned city" });
    }

    const { img, status } = req.body;
    const data = {};
    if (img !== undefined) data.img = img;
    if (status !== undefined) data.status = Number(status);

    const updated = await prisma.tbl_banner.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Banner updated", data: updated });
  } catch (err) {
    return internalError(res, err, "marketing.updateBanner");
  }
}

async function deleteBanner(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_banner.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }
    if (req.user.role === "admin" && existing.city_id !== parseInt(req.user.city_id, 10)) {
      return res.status(403).json({ success: false, message: "Forbidden: banner is outside your assigned city" });
    }
    await prisma.tbl_banner.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Banner deleted" });
  } catch (err) {
    return internalError(res, err, "marketing.deleteBanner");
  }
}

// ---------------------------------------------------------------------------
// Coupons (tbl_coupon) — real schema: c_title/c_value/c_desc/c_img/cdate,
// min_amt, ulimit (per-user redemption limit), cusefor, city (single int,
// not a list), status.
// ---------------------------------------------------------------------------

async function listCoupons(req, res) {
  try {
    const rows = await prisma.tbl_coupon.findMany({ orderBy: { id: "desc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "marketing.listCoupons");
  }
}

async function createCoupon(req, res) {
  try {
    const { c_title, ctitle, c_value, c_desc, c_img, min_amt, ulimit, cusefor, city, status, cdate } = req.body;
    if (!c_title || c_value === undefined || !min_amt) {
      return res.status(400).json({ success: false, message: "c_title, c_value and min_amt are required" });
    }
    const created = await prisma.tbl_coupon.create({
      data: {
        c_title,
        ctitle: ctitle || c_title,
        c_value: String(c_value),
        c_desc: c_desc || "",
        c_img: c_img || "",
        min_amt: Number(min_amt),
        ulimit: ulimit !== undefined ? Number(ulimit) : 1,
        cusefor: cusefor !== undefined ? Number(cusefor) : 0,
        city: city !== undefined ? Number(city) : 0,
        status: status === undefined ? 1 : Number(status),
        cdate: cdate ? new Date(cdate) : new Date(),
      },
    });
    return res.status(201).json({ success: true, message: "Coupon created", data: created });
  } catch (err) {
    return internalError(res, err, "marketing.createCoupon");
  }
}

async function updateCoupon(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_coupon.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    const { c_title, ctitle, c_value, c_desc, c_img, min_amt, ulimit, cusefor, city, status } = req.body;
    const data = {};
    if (c_title !== undefined) data.c_title = c_title;
    if (ctitle !== undefined) data.ctitle = ctitle;
    if (c_value !== undefined) data.c_value = String(c_value);
    if (c_desc !== undefined) data.c_desc = c_desc;
    if (c_img !== undefined) data.c_img = c_img;
    if (min_amt !== undefined) data.min_amt = Number(min_amt);
    if (ulimit !== undefined) data.ulimit = Number(ulimit);
    if (cusefor !== undefined) data.cusefor = Number(cusefor);
    if (city !== undefined) data.city = Number(city);
    if (status !== undefined) data.status = Number(status);

    const updated = await prisma.tbl_coupon.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Coupon updated", data: updated });
  } catch (err) {
    return internalError(res, err, "marketing.updateCoupon");
  }
}

async function deleteCoupon(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_coupon.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    await prisma.tbl_coupon.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Coupon deleted" });
  } catch (err) {
    return internalError(res, err, "marketing.deleteCoupon");
  }
}

// ---------------------------------------------------------------------------
// Premium plans (tbl_premium_plan) — the live schema is a much richer loyalty
// engine than the spec doc's simple description; only a curated subset of
// fields is accepted here (the rest keep their column defaults).
// ---------------------------------------------------------------------------

const PLAN_FIELDS = [
  "plan_name",
  "plan_for",
  "validity_days",
  "price",
  "description",
  "plan_image",
  "is_popular",
  "discount_enabled",
  "discount_percent",
  "incentive_enabled",
  "incentive_type",
  "incentive_value",
  "wallet_bonus_enabled",
  "wallet_bonus_amount",
  "city",
  "sort_order",
  "status",
];

async function listPremiumPlans(req, res) {
  try {
    const rows = await prisma.tbl_premium_plan.findMany({ orderBy: [{ sort_order: "asc" }, { id: "asc" }] });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "marketing.listPremiumPlans");
  }
}

async function createPremiumPlan(req, res) {
  try {
    const b = req.body;
    if (!b.plan_name || !b.plan_for || b.price === undefined) {
      return res.status(400).json({ success: false, message: "plan_name, plan_for and price are required" });
    }
    if (!["USER", "DRIVER"].includes(b.plan_for)) {
      return res.status(400).json({ success: false, message: "plan_for must be USER or DRIVER" });
    }

    const data = { plan_name: b.plan_name, plan_for: b.plan_for, price: b.price, city: b.city || "all", guarantee_driver: Boolean(b.guarantee_driver) };
    for (const field of PLAN_FIELDS) {
      if (field === "plan_name" || field === "plan_for" || field === "price" || field === "city") continue;
      if (b[field] !== undefined) data[field] = b[field];
    }

    const created = await prisma.tbl_premium_plan.create({ data });
    return res.status(201).json({ success: true, message: "Premium plan created", data: created });
  } catch (err) {
    return internalError(res, err, "marketing.createPremiumPlan");
  }
}

async function updatePremiumPlan(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_premium_plan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Premium plan not found" });
    }

    const b = req.body;
    if (b.plan_for !== undefined && !["USER", "DRIVER"].includes(b.plan_for)) {
      return res.status(400).json({ success: false, message: "plan_for must be USER or DRIVER" });
    }

    const data = {};
    for (const field of [...PLAN_FIELDS, "guarantee_driver"]) {
      if (b[field] !== undefined) data[field] = b[field];
    }

    const updated = await prisma.tbl_premium_plan.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Premium plan updated", data: updated });
  } catch (err) {
    return internalError(res, err, "marketing.updatePremiumPlan");
  }
}

async function deletePremiumPlan(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_premium_plan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Premium plan not found" });
    }
    await prisma.tbl_premium_plan.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Premium plan deleted" });
  } catch (err) {
    return internalError(res, err, "marketing.deletePremiumPlan");
  }
}

module.exports = {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  listPremiumPlans,
  createPremiumPlan,
  updatePremiumPlan,
  deletePremiumPlan,
};
