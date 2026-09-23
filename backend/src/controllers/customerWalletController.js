const prisma = require("../config/db");
const logger = require("../utils/logger");
const { verifyRazorpayPayment } = require("../utils/razorpayVerify");

// Node port of cust_api/add_wallet.php, wallet_history.php,
// withdraw_wallet.php + rider_api equivalents (rider_api has no dedicated
// wallet endpoints of its own - riders share the same wallet_type="driver"
// branch of these same handlers in the PHP source, so one controller
// serves both apps here too via the `wallet_type` field).
//
// Razorpay verification lives in utils/razorpayVerify.js (shared with
// customerPlanService's premium-plan purchase, which needs the same
// signature + amount/status check against Razorpay's API - see that file
// for why signature-only verification isn't enough).

function fail(res, msg) {
  return res.status(200).json({ Result: false, msg });
}

// --- create_order.php --- (rider_api's Razorpay order-creation step, ahead
// of add_wallet.php's verify-and-credit step above. No existing Node
// endpoint created a Razorpay order server-side yet - addWallet only ever
// verified a payment the client already completed - so this is new, not a
// port of logic that lived elsewhere in this codebase. Uses the same raw
// fetch()-based approach as razorpayVerify.js rather than pulling in the
// Razorpay SDK for one call.)
async function createRazorpayOrder(req, res) {
  // Always resolve with HTTP 200 + a ResponseCode/Result envelope, never a
  // non-2xx status - ApiWrapper.dataPostNode (ShifterOnline) only decodes the
  // JSON body when statusCode == 200, discarding it (and any ResponseMsg)
  // otherwise. Same "200 always, logical status in the body" convention the
  // rest of this codebase's cust_api/rider_api ports already use.
  try {
    const amount = Number(req.body?.amount || 0);
    if (!amount || amount <= 0) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Valid amount is required" });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      logger.error("createRazorpayOrder: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.");
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Payment gateway is not configured. Try again later." });
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const resp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // paise
        currency: "INR",
        receipt: `wallet_${Date.now()}`,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      logger.error("createRazorpayOrder: Razorpay API error:", data);
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: data?.error?.description || "Failed to create payment order" });
    }

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Order created",
      OrderId: data.id,
      order_id: data.id,
      amount: data.amount,
      currency: data.currency,
    });
  } catch (err) {
    logger.error("createRazorpayOrder failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
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

    let verification;
    try {
      verification = await verifyRazorpayPayment({
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
        signature: razorpaySignature,
        expectedAmountRupees: amount,
      });
    } catch (e) {
      logger.error("addWallet: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured - refusing to credit any wallet.", e);
      return res.status(200).json({ Result: false, msg: "Payment verification is not configured. Try again later." });
    }
    if (!verification.ok) return fail(res, verification.reason);

    const account =
      walletType === "user"
        ? await prisma.tbl_user.findFirst({ where: { mobile: Number(mobile) } })
        : await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!account) return fail(res, walletType === "user" ? "No user found with this mobile number!" : "No driver found with this mobile number!");

    // Idempotency backed by a real DB unique constraint on
    // razorpay_payment_id (see schema.prisma comment on that column) - two
    // concurrent requests replaying the same payment_id can no longer both
    // succeed, since the second insert hits the unique index and fails with
    // P2002 regardless of what either request read beforehand.
    try {
      await prisma.tbl_wallet_history.create({
        data: {
          user_id: account.id,
          mobile,
          amount,
          type: "credit",
          remark: "Wallet Recharge",
          payment_id: razorpayPaymentId,
          razorpay_payment_id: razorpayPaymentId,
          wallet_type: walletType,
          created_at: new Date(),
        },
      });
    } catch (e) {
      if (e.code === "P2002") return fail(res, "This payment has already been credited.");
      throw e;
    }

    let newBalance;
    if (walletType === "user") {
      const updated = await prisma.tbl_user.update({ where: { id: account.id }, data: { wallet: { increment: amount } } });
      newBalance = Number(updated.wallet);
    } else {
      const updated = await prisma.tbl_rider.update({ where: { id: account.id }, data: { wallet_balance: { increment: amount } } });
      newBalance = Number(updated.wallet_balance);
    }

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
    let withdrawalSummary = {};
    if (walletType === "driver") {
      const [pending, latest] = await Promise.all([
        prisma.driver_withdraw_requests.aggregate({ where: { rider_id: userId, status: "pending" }, _sum: { amount: true } }),
        prisma.driver_withdraw_requests.findFirst({ where: { rider_id: userId }, orderBy: { id: "desc" }, select: { id: true, amount: true, status: true, created_at: true } }),
      ]);
      const pendingAmount = Number(pending._sum.amount || 0);
      withdrawalSummary = {
        pending_withdrawal_amount: pendingAmount.toFixed(2),
        available_to_withdraw: Math.max(0, Number(wallet || 0) - pendingAmount).toFixed(2),
        latest_withdrawal: latest ? { id: latest.id, amount: Number(latest.amount || 0).toFixed(2), status: latest.status, created_at: latest.created_at } : null,
      };
    }
    const totalCredit = rows.filter((r) => r.type === "credit").reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalDebit = rows.filter((r) => r.type === "debit").reduce((s, r) => s + Number(r.amount || 0), 0);

    return res.status(200).json({
      Result: true,
      msg: "Wallet History",
      wallet_balance: wallet?.toString?.() ?? wallet,
      wallet_points: walletPoints,
      ...withdrawalSummary,
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

module.exports = { addWallet, walletHistory, withdrawWallet, createRazorpayOrder };
