const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function riderName(r) {
  return r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;
}

async function list(req, res) {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const rows = await prisma.driver_withdraw_requests.findMany({ where, orderBy: { id: "desc" } });

    const riderIds = [...new Set(rows.map((w) => w.rider_id).filter(Boolean))];
    const riders = await prisma.tbl_rider.findMany({ where: { id: { in: riderIds } } });
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const bankAccounts = await prisma.tbl_bank_account.findMany({ where: { rider_id: { in: riderIds } } });
    const bankByRiderId = Object.fromEntries(bankAccounts.map((b) => [b.rider_id, b]));

    // A handful of legacy rows never got city_id set — fall back to the
    // rider's own city so scoping still works for them.
    const scoped = rows.filter((w) => {
      if (!req.scopedCityId) return true;
      const cityId = w.city_id ?? riderById[w.rider_id]?.city_id ?? null;
      return cityId === req.scopedCityId;
    });

    const data = scoped.map((w) => {
      const rider = riderById[w.rider_id];
      const bank = bankByRiderId[w.rider_id];
      return {
        id: w.id,
        rider_id: w.rider_id,
        rider_name: rider ? riderName(rider) : null,
        rider_mobile: rider ? rider.fmobile : null,
        amount: w.amount,
        bank_account: bank
          ? { bank_name: bank.bank_name, account_no: bank.iban_num, ifsc: bank.ifsc_code }
          : null,
        status: w.status,
        created_at: w.created_at,
      };
    });

    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "payouts.list");
  }
}

async function approve(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { transaction_reference, payment_proof_url } = req.body;

    const withdrawal = await prisma.driver_withdraw_requests.findUnique({ where: { id } });
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: "Withdrawal request not found" });
    }
    if (withdrawal.status !== "pending") {
      return res.status(409).json({ success: false, message: `Withdrawal request is already ${withdrawal.status}` });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: withdrawal.rider_id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver for this withdrawal request no longer exists" });
    }
    const cityId = withdrawal.city_id ?? rider.city_id ?? null;
    if (req.user.role !== "superadmin" && cityId !== parseInt(req.user.city_id, 10)) {
      return res.status(403).json({ success: false, message: "Forbidden: withdrawal request is outside your assigned city" });
    }

    const amount = Number(withdrawal.amount);
    if (Number(rider.wallet_balance) < amount) {
      return res.status(409).json({ success: false, message: "Driver's wallet balance is lower than the requested amount" });
    }

    const remarkParts = [`Payout approved (withdrawal #${id})`];
    if (transaction_reference) remarkParts.push(`ref: ${transaction_reference}`);
    if (payment_proof_url) remarkParts.push(`proof: ${payment_proof_url}`);

    await prisma.$transaction([
      prisma.driver_withdraw_requests.update({ where: { id }, data: { status: "approved" } }),
      prisma.tbl_rider.update({ where: { id: rider.id }, data: { wallet_balance: { decrement: amount } } }),
      prisma.tbl_wallet_history.create({
        data: {
          user_id: rider.id,
          amount,
          type: "debit",
          remark: remarkParts.join(" — "),
          wallet_type: "driver",
          created_at: new Date(),
        },
      }),
      prisma.tbl_rnoti.create({
        data: {
          rid: rider.id,
          title: "Payout approved",
          msg: `Your withdrawal of ${amount} has been approved and paid out.${transaction_reference ? ` Reference: ${transaction_reference}` : ""}`,
          type: "payout",
          date: new Date(),
        },
      }),
    ]);

    return res.status(200).json({ success: true, message: "Withdrawal request approved" });
  } catch (err) {
    return internalError(res, err, "payouts.approve");
  }
}

async function reject(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { rejection_reason } = req.body;

    const withdrawal = await prisma.driver_withdraw_requests.findUnique({ where: { id } });
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: "Withdrawal request not found" });
    }
    if (withdrawal.status !== "pending") {
      return res.status(409).json({ success: false, message: `Withdrawal request is already ${withdrawal.status}` });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: withdrawal.rider_id } });
    const cityId = withdrawal.city_id ?? rider?.city_id ?? null;
    if (req.user.role !== "superadmin" && cityId !== parseInt(req.user.city_id, 10)) {
      return res.status(403).json({ success: false, message: "Forbidden: withdrawal request is outside your assigned city" });
    }

    await prisma.driver_withdraw_requests.update({ where: { id }, data: { status: "rejected" } });

    if (rider) {
      await prisma.tbl_rnoti.create({
        data: {
          rid: rider.id,
          title: "Payout rejected",
          msg: `Your withdrawal request was rejected${rejection_reason ? `: ${rejection_reason}` : "."}`,
          type: "payout",
          date: new Date(),
        },
      });
    }

    return res.status(200).json({ success: true, message: "Withdrawal request rejected" });
  } catch (err) {
    return internalError(res, err, "payouts.reject");
  }
}

module.exports = { list, approve, reject };
