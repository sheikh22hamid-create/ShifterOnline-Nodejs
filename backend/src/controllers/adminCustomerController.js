const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function isScopedOut(req, customerCityId) {
  return req.user.role !== "superadmin" && customerCityId !== parseInt(req.user.city_id, 10);
}

async function attachCityNames(rows) {
  const cityIds = [...new Set(rows.map((r) => r.city_id).filter(Boolean))];
  if (cityIds.length === 0) return rows.map((r) => ({ ...r, city_name: null }));
  const cities = await prisma.tbl_city.findMany({ where: { id: { in: cityIds } }, select: { id: true, title: true } });
  const nameById = Object.fromEntries(cities.map((c) => [c.id, c.title]));
  return rows.map((r) => ({ ...r, city_name: r.city_id ? nameById[r.city_id] || null : null }));
}

async function list(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;
    if (req.query.status !== undefined) where.status = parseInt(req.query.status, 10);
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search } },
        { email: { contains: req.query.search } },
        { mobile: Number.isFinite(Number(req.query.search)) ? Number(req.query.search) : -1 },
      ];
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const [total, rows] = await Promise.all([
      prisma.tbl_user.count({ where }),
      prisma.tbl_user.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * limit, take: limit }),
    ]);

    const withCity = await attachCityNames(rows);
    const ids = rows.map((u) => u.id);
    const orderCounts = ids.length
      ? await prisma.pkg_order.groupBy({ by: ["uid"], where: { uid: { in: ids } }, _count: { id: true } })
      : [];
    const orderCountByUid = Object.fromEntries(orderCounts.map((r) => [r.uid, r._count.id]));

    const data = withCity.map((u) => ({
      id: u.id,
      fname: u.name,
      email: u.email,
      mobile: String(u.mobile),
      city_id: u.city_id,
      city_name: u.city_name,
      wallet: u.wallet,
      plan_type: u.plan_type,
      status: u.status,
      total_orders: orderCountByUid[u.id] || 0,
      registered_at: u.rdate,
    }));

    return res.status(200).json({ success: true, total, page, limit, data });
  } catch (err) {
    return internalError(res, err, "customers.list");
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const customer = await prisma.tbl_user.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    if (isScopedOut(req, customer.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: customer is outside your assigned city" });
    }

    const [cityName, addresses, favoriteDrivers, recentOrders] = await Promise.all([
      customer.city_id ? prisma.tbl_city.findUnique({ where: { id: customer.city_id }, select: { title: true } }) : null,
      prisma.tbl_address.findMany({ where: { uid: id } }),
      prisma.tbl_fav_driver.findMany({ where: { uid: id, status: true } }),
      prisma.pkg_order.findMany({ where: { uid: id }, orderBy: { id: "desc" }, take: 10 }),
    ]);

    const favRiderIds = favoriteDrivers.map((f) => f.rid);
    const favRiders = favRiderIds.length
      ? await prisma.tbl_rider.findMany({ where: { id: { in: favRiderIds } }, select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true } })
      : [];
    const favRiderById = Object.fromEntries(favRiders.map((r) => [r.id, r]));

    return res.status(200).json({
      success: true,
      data: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        mobile: String(customer.mobile),
        city_id: customer.city_id,
        city_name: cityName ? cityName.title : null,
        wallet: customer.wallet,
        plan_type: customer.plan_type,
        status: customer.status,
        registered_at: customer.rdate,
        referral_points: customer.referral_points,
        referral_code: customer.referral_code,
        addresses,
        favorite_drivers: favoriteDrivers.map((f) => {
          const r = favRiderById[f.rid];
          return { rider_id: f.rid, rider_name: r ? r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() : null, rider_mobile: r ? r.fmobile : null };
        }),
        recent_orders: recentOrders,
      },
    });
  } catch (err) {
    return internalError(res, err, "customers.getOne");
  }
}

async function toggleStatus(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, reason } = req.body;
    if (status !== 0 && status !== 1) {
      return res.status(400).json({ success: false, message: "status must be 0 or 1" });
    }

    const customer = await prisma.tbl_user.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    if (isScopedOut(req, customer.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: customer is outside your assigned city" });
    }

    const updated = await prisma.tbl_user.update({ where: { id }, data: { status } });

    await prisma.tbl_notification.create({
      data: {
        uid: id,
        title: status === 1 ? "Account reactivated" : "Account blocked",
        description: status === 1 ? "Your account has been reactivated." : `Your account was blocked${reason ? `: ${reason}` : "."}`,
        datetime: new Date(),
      },
    });

    return res.status(200).json({ success: true, message: "Customer status updated", data: { id: updated.id, status: updated.status } });
  } catch (err) {
    return internalError(res, err, "customers.toggleStatus");
  }
}

async function walletAdjust(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { amount, type, remark } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "amount must be a positive number" });
    }
    if (!["credit", "debit"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be credit or debit" });
    }

    const customer = await prisma.tbl_user.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    if (isScopedOut(req, customer.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: customer is outside your assigned city" });
    }

    const amt = Number(amount);
    if (type === "debit" && Number(customer.wallet) < amt) {
      return res.status(400).json({ success: false, message: "Insufficient wallet balance for this debit" });
    }

    const [updatedCustomer] = await prisma.$transaction([
      prisma.tbl_user.update({
        where: { id },
        data: { wallet: type === "credit" ? { increment: amt } : { decrement: amt } },
      }),
      prisma.tbl_wallet_history.create({
        data: {
          user_id: id,
          amount: amt,
          type,
          remark: remark || `Manual ${type} by admin #${req.user.id}`,
          wallet_type: "user",
          created_at: new Date(),
        },
      }),
    ]);

    return res.status(200).json({ success: true, message: "Wallet adjusted", data: { id: updatedCustomer.id, wallet: updatedCustomer.wallet } });
  } catch (err) {
    return internalError(res, err, "customers.walletAdjust");
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const customer = await prisma.tbl_user.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    // o_status is checked alongside order_status because cancel() never
    // resets order_status, only o_status — see adminOrderController.js.
    const activeOrderCount = await prisma.pkg_order.count({
      where: { uid: id, order_status: { in: [0, 1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
    });
    if (activeOrderCount) {
      return res.status(409).json({ success: false, message: "Cannot delete a customer with an order in progress" });
    }

    await prisma.$transaction([
      prisma.tbl_user_device.deleteMany({ where: { uid: id } }),
      prisma.tbl_fav_driver.deleteMany({ where: { uid: id } }),
      prisma.tbl_favorite_driver.deleteMany({ where: { user_id: id } }),
      prisma.tbl_address.deleteMany({ where: { uid: id } }),
      prisma.tbl_user.delete({ where: { id } }),
    ]);

    return res.status(200).json({ success: true, message: "Customer deleted" });
  } catch (err) {
    return internalError(res, err, "customers.remove");
  }
}

module.exports = { list, getOne, toggleStatus, walletAdjust, remove };
