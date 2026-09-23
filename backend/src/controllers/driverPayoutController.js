const prisma = require("../config/db");
const logger = require("../utils/logger");

// Node port of rider_api/payout_list.php, request_payout.php,
// withdraw_requests.php.
//
// payout.php (a dead Stripe Connect test script - print_r()'d a hardcoded
// test-mode API key and never returned JSON) and check_amount.php (a
// separate UPI pickup-charge calculator that overlaps with the pricing
// engine already built for the new order flow - services/pricingEngine.js)
// are intentionally NOT ported here; see the migration summary.
//
// Earnings formula: the PHP versions summed a formula referencing
// `complxity_charge`, `e_commission`, and `delivery_boy_take_charge` on
// buy_order/pkg_order - none of those columns exist on either table in
// this schema, so that query would already fail against the current DB.
// Replaced with SUM(pkg_order.driver_earning) for Completed orders, which
// is the actual per-trip earning the new dispatch/pricing flow computes
// and stores (see services/pricingEngine.js, services/tripLifecycle.js).

function fail(res, msg) {
  return res.status(200).json({ Result: false, msg });
}

async function totalEarning(riderId) {
  const agg = await prisma.pkg_order.aggregate({
    where: { rid: riderId, o_status: "Completed" },
    _sum: { driver_earning: true },
  });
  // Only pending/approved payouts actually reduce what's left to withdraw -
  // a rejected request never paid the driver anything, so it must not
  // permanently deduct from their earnings. `status` is free-text (set by
  // the admin side); MySQL's default collation already compares it
  // case-insensitively, so a plain `not` here also catches "Rejected" /
  // "REJECTED" (Prisma's `mode: "insensitive"` isn't supported on MySQL).
  const payoutAgg = await prisma.payout_setting.aggregate({
    where: { rid: riderId, NOT: { status: "rejected" } },
    _sum: { amt: true },
  });
  const earned = Number(agg._sum.driver_earning || 0);
  const paidOut = Number(payoutAgg._sum.amt || 0);
  return Math.round((earned - paidOut) * 100) / 100;
}

// --- payout_list.php ---
async function payoutList(req, res) {
  try {
    const rid = Number(req.body?.rid || 0);
    if (!rid) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went wrong  try again !" });

    const rows = await prisma.payout_setting.findMany({ where: { rid } });
    const list = rows.map((p) => ({
      payout_id: p.id,
      amt: p.amt,
      status: p.status,
      proof: p.proof,
      r_date: p.r_date,
      r_type: p.r_type,
      acc_number: p.acc_number,
      bank_name: p.bank_name,
      acc_name: p.acc_name,
      ifsc_code: p.ifsc_code,
      upi_id: p.upi_id,
      paypal_id: p.paypal_id,
    }));

    const totalEarningAmt = await totalEarning(rid);
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: list.length ? "Payout List Get Successfully!!!" : "Payout List Not Found!!",
      Payoutlist: list,
      total_earning: totalEarningAmt,
    });
  } catch (err) {
    logger.error("driverPayoutController.payoutList failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

const VALID_R_TYPES = new Set(["UPI", "BANK_Transfer", "Paypal"]);

// --- request_payout.php ---
async function requestPayout(req, res) {
  try {
    const b = req.body || {};
    const rid = Number(b.rid || 0);
    const amt = Number(b.amt || 0);
    const rType = b.r_type;
    if (!rid || !amt || !rType) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went Wrong!" });
    if (!VALID_R_TYPES.has(rType)) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Invalid payout type!" });
    }

    const totalEarningAmt = await totalEarning(rid);
    if (amt > totalEarningAmt) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "You can't Withdraw Above Your Earning!" });
    }

    await prisma.payout_setting.create({
      data: {
        rid,
        amt,
        status: "pending",
        r_date: new Date(),
        r_type: rType,
        acc_number: b.acc_number || null,
        bank_name: b.bank_name || null,
        acc_name: b.acc_name || null,
        ifsc_code: b.ifsc_code || null,
        upi_id: b.upi_id || null,
        paypal_id: b.paypal_id || null,
      },
    });

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Payout Request Submit Successfully!!" });
  } catch (err) {
    logger.error("driverPayoutController.requestPayout failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// --- withdraw_requests.php --- (wallet-balance withdrawal, distinct from
// the trip-earnings payout above)
//
// SUPERSEDED as of 2026-09-23 by customerWalletController.withdrawWallet's
// immediate, atomic self-service withdraw (see
// docs/superpowers/specs/2026-09-23-driver-wallet-outstanding-dues-design.md).
// Left in place with its data intact for historical withdrawal records and
// payoutController's admin approve/reject screens - do not build new
// driver-facing withdrawal features on this path.
async function withdrawRequest(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    const amount = Number(req.body?.amount || 0);
    if (!riderId || !amount) return fail(res, "Missing Data");

    // wallet_balance itself is only decremented when admin approves the
    // request (payoutController.js approveWithdrawal, which re-checks
    // balance at that point) - it must NOT be touched here too, or approval
    // would double-decrement. The bug this guards against is queuing
    // multiple *pending* requests that together exceed the real balance: a
    // plain findUnique-then-create let two concurrent requests both read the
    // same wallet_balance and both pass, ignoring each other and any
    // already-pending request. Check against balance minus what's already
    // reserved by other pending requests instead.
    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) return fail(res, "Insufficient Balance");

    const pendingAgg = await prisma.driver_withdraw_requests.aggregate({
      where: { rider_id: riderId, status: "pending" },
      _sum: { amount: true },
    });
    const alreadyPending = Number(pendingAgg._sum.amount || 0);
    const available = Number(rider.wallet_balance || 0) - alreadyPending;
    if (available < amount) {
      return fail(res, "Insufficient Balance");
    }

    await prisma.driver_withdraw_requests.create({ data: { rider_id: riderId, amount, status: "pending" } });
    return res.status(200).json({ Result: true, msg: "Withdraw request sent to admin" });
  } catch (err) {
    logger.error("driverPayoutController.withdrawRequest failed:", err);
    return fail(res, "Internal server error");
  }
}

module.exports = { payoutList, requestPayout, withdrawRequest };
