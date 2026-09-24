const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

// Cross-entity audit report of every manual credit/debit an admin has made
// to a driver's or customer's wallet, superadmin-only. Manual adjustments are
// tagged by adminCustomerController/adminRiderController.walletAdjust via
// payment_id = "admin_adjustment_<adminId>" (see those files) - this is the
// one place that marker is read back out.
async function list(req, res) {
  try {
    const where = { payment_id: { startsWith: "admin_adjustment_" } };
    if (req.query.wallet_type && ["user", "driver"].includes(req.query.wallet_type)) {
      where.wallet_type = req.query.wallet_type;
    }
    if (req.query.type && ["credit", "debit"].includes(req.query.type)) {
      where.type = req.query.type;
    }
    if (req.query.from || req.query.to) {
      where.created_at = {};
      if (req.query.from) where.created_at.gte = new Date(req.query.from);
      if (req.query.to) where.created_at.lte = new Date(req.query.to);
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const [total, rows] = await Promise.all([
      prisma.tbl_wallet_history.count({ where }),
      prisma.tbl_wallet_history.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * limit, take: limit }),
    ]);

    const adminIds = [...new Set(rows.map((r) => parseInt(r.payment_id.replace("admin_adjustment_", ""), 10)).filter(Number.isFinite))];
    const admins = adminIds.length ? await prisma.admin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, username: true } }) : [];
    const adminById = Object.fromEntries(admins.map((a) => [a.id, a.name || a.username]));

    const userIds = rows.filter((r) => r.wallet_type === "user").map((r) => r.user_id);
    const driverIds = rows.filter((r) => r.wallet_type === "driver").map((r) => r.user_id);

    const [users, drivers] = await Promise.all([
      userIds.length ? prisma.tbl_user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, mobile: true } }) : [],
      driverIds.length ? prisma.tbl_rider.findMany({ where: { id: { in: driverIds } }, select: { id: true, full_name: true, fmobile: true } }) : [],
    ]);
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));

    const data = rows.map((r) => {
      const adminId = parseInt(r.payment_id.replace("admin_adjustment_", ""), 10);
      const entity = r.wallet_type === "driver" ? driverById[r.user_id] : userById[r.user_id];
      return {
        id: r.id,
        wallet_type: r.wallet_type,
        entity_id: r.user_id,
        entity_name: r.wallet_type === "driver" ? entity?.full_name || `Driver #${r.user_id}` : entity?.name || `Customer #${r.user_id}`,
        entity_mobile: r.wallet_type === "driver" ? entity?.fmobile : entity?.mobile,
        type: r.type,
        amount: r.amount,
        remark: r.remark,
        admin_id: Number.isFinite(adminId) ? adminId : null,
        admin_name: Number.isFinite(adminId) ? adminById[adminId] || `Admin #${adminId}` : "Unknown",
        created_at: r.created_at,
      };
    });

    return res.status(200).json({ success: true, total, page, limit, data });
  } catch (err) {
    return internalError(res, err, "walletAdjustments.list");
  }
}

module.exports = { list };
