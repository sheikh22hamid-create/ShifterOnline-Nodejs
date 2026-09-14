const crypto = require("crypto");
const prisma = require("../config/db");
const logger = require("../utils/logger");

// Node port of cust_api/add_wallet.php, wallet_history.php,
// withdraw_wallet.php + rider_api equivalents (rider_api has no dedicated
// wallet endpoints of its own - riders share the same wallet_type="driver"
// branch of these same handlers in the PHP source, so one controller
// serves both apps here too via the `wallet_type` field).
//
// Razorpay signature verification. Unlike the 2Factor OTP key (low blast
// radius, send-only, already public across this repo's PHP source), this
// key verifies that a wallet-credit request actually came from Razorpay —
// anyone who reads a hardcoded copy of it can forge a valid signature and
// mint free wallet balance. No fallback to the old hardcoded test key:
// addWallet refuses each request instead if the env var isn't set. (Checked
// lazily, not at module load, so the rest of the app - and every route that
// isn't this one - still boots and runs tests fine without it configured.)
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

function fail(res, msg) {
  return res.status(200).json({ Result: false, msg });
}

// --- add_wallet.php ---
async function addWallet(req, res) {
  try {
    const b = req.body || {};
    const mobile = String(b.mobile || "");
    const amount = Number(b.amount || 0);
    const walletType = b.wallet_type; // "user" | "driver"
    const razorpayPaymentId = b.razorpay_payment_id;
    const razorpayOrderId = b.razorpay_order_id;
    const razorpaySignature = b.razorpay_signature;

    if (!mobile || !amount || !walletType || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      return fail(res, "Missing Parameters");
    }
    if (!RAZORPAY_KEY_SECRET) {
      logger.error("addWallet: RAZORPAY_KEY_SECRET is not configured - refusing to credit any wallet.");
      return res.status(200).json({ Result: false, msg: "Payment verification is not configured. Try again later." });
    }

    const generatedSignature = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
    if (generatedSignature !== razorpaySignature) {
      return fail(res, "Payment Verification Failed!");
    }

    let userId;
    let newBalance;

    if (walletType === "user") {
      const user = await prisma.tbl_user.findFirst({ where: { mobile: Number(mobile) } });
      if (!user) return fail(res, "No user found with this mobile number!");
      newBalance = Number(user.wallet) + amount;
      await prisma.tbl_user.update({ where: { id: user.id }, data: { wallet: newBalance } });
      userId = user.id;
    } else {
      const rider = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
      if (!rider) return fail(res, "No driver found with this mobile number!");
      newBalance = Number(rider.wallet_balance || 0) + amount;
      await prisma.tbl_rider.update({ where: { id: rider.id }, data: { wallet_balance: newBalance } });
      userId = rider.id;
    }

    await prisma.tbl_wallet_history.create({
      data: {
        user_id: userId,
        mobile,
        amount,
        type: "credit",
        remark: "Wallet Recharge",
        payment_id: razorpayPaymentId,
        wallet_type: walletType,
        created_at: new Date(),
      },
    });

    return res.status(200).json({ Result: true, msg: "Wallet Recharge Success", balance: newBalance });
  } catch (err) {
    logger.error("customerWalletController.addWallet failed:", err);
    return fail(res, "Internal server error");
  }
}

// --- wallet_history.php ---
async function walletHistory(req, res) {
  try {
    const b = req.body || {};
    const mobile = String(b.mobile || "");
    const walletType = b.wallet_type;
    const fromDate = b.from_date;
    const toDate = b.to_date;
    const txnType = b.txn_type;
    if (!mobile || !walletType) return fail(res, "Missing Parameters");

    const account =
      walletType === "user"
        ? await prisma.tbl_user.findFirst({ where: { mobile: Number(mobile) } })
        : await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!account) return fail(res, "User Not Found");

    const userId = account.id;
    const wallet = walletType === "user" ? account.wallet : account.wallet_balance;
    const walletPoints = account.referral_points ?? 0;

    const where = { user_id: userId, wallet_type: walletType };
    if (txnType) where.type = txnType;
    if (fromDate && toDate) {
      where.created_at = { gte: new Date(`${fromDate}T00:00:00`), lte: new Date(`${toDate}T23:59:59`) };
    }

    const rows = await prisma.tbl_wallet_history.findMany({ where, orderBy: { id: "desc" } });
    const totalCredit = rows.filter((r) => r.type === "credit").reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalDebit = rows.filter((r) => r.type === "debit").reduce((s, r) => s + Number(r.amount || 0), 0);

    return res.status(200).json({
      Result: true,
      msg: "Wallet History",
      wallet_balance: wallet?.toString?.() ?? wallet,
      wallet_points: walletPoints,
      total_credit: totalCredit,
      total_debit: totalDebit,
      data: rows,
    });
  } catch (err) {
    logger.error("customerWalletController.walletHistory failed:", err);
    return fail(res, "Internal server error");
  }
}

// --- withdraw_wallet.php ---
async function withdrawWallet(req, res) {
  try {
    const b = req.body || {};
    const mobile = String(b.mobile || "");
    const amount = Number(b.amount || 0);
    const walletType = b.wallet_type || "user";
    const remark = b.remark || "Wallet Withdraw";
    if (!mobile || !amount || !walletType) return fail(res, "Missing Data");

    const account =
      walletType === "user"
        ? await prisma.tbl_user.findFirst({ where: { mobile: Number(mobile) } })
        : await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!account) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Mobile Not Found!" });
    }

    const currentBalance = Number(walletType === "user" ? account.wallet : account.wallet_balance || 0);
    if (currentBalance < amount) {
      return res.status(200).json({ ResponseCode: "402", Result: "false", ResponseMsg: "Insufficient Balance!" });
    }

    const newBalance = currentBalance - amount;
    if (walletType === "user") {
      await prisma.tbl_user.update({ where: { id: account.id }, data: { wallet: newBalance } });
    } else {
      await prisma.tbl_rider.update({ where: { id: account.id }, data: { wallet_balance: newBalance } });
    }

    await prisma.tbl_wallet_history.create({
      data: { user_id: account.id, mobile, amount, type: "debit", remark, wallet_type: walletType, created_at: new Date() },
    });

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Withdraw Successful!", NewBalance: newBalance });
  } catch (err) {
    logger.error("customerWalletController.withdrawWallet failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { addWallet, walletHistory, withdrawWallet };
