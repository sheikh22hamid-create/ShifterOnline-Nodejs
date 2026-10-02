const prisma = require("../config/db");
const { istNow, formatLedgerTime } = require("../utils/istTime");
const logger = require("../utils/logger");
const { verifyRazorpayPayment, fetchRazorpayOrder } = require("../utils/razorpayVerify");
const { getDriverMaxDueLimit, getDriverMinWithdrawalAmount, getCustomerWalletMaxTopup } = require("../services/driverWalletSettings");
const walletNotifier = require("../services/walletNotifier");

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
    const maxTopup = await getCustomerWalletMaxTopup();
    if (amount > maxTopup) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: `Maximum amount limit is ₹${maxTopup} per transaction` });
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

// --- Clear Outstanding Due (driver-only) ---
// createClearDueOrder computes the order amount server-side from the
// driver's current wallet_balance - never from the client - and tags the
// order's `receipt` with the rider's id so clearOutstandingDue can later
// confirm a payment was actually made against *this* clear-due order and
// not some other order the client happens to have a valid payment for.
// clearOutstandingDue re-fetches that order from Razorpay (never trusts a
// client-supplied amount), checks the receipt belongs to this rider, and
// clamps the credit to the rider's real outstanding due at the moment of
// crediting - so even a payment for more than the due, or a due that
// shrank between order creation and payment (e.g. an admin adjustment
// landed in between), can never push the wallet balance positive. Any
// amount paid beyond the due is not tracked/refunded here - out of scope,
// see design spec 2026-09-23-driver-wallet-outstanding-dues-design.md.
async function createClearDueOrder(req, res) {
  try {
    const mobile = String(req.body?.mobile || "");
    if (!mobile) return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "Missing Data" });

    const rider = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!rider) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "No driver found with this mobile number!" });

    const dueAmount = Math.max(0, -Number(rider.wallet_balance || 0));
    if (dueAmount <= 0) {
      return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "No outstanding dues to clear." });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      logger.error("createClearDueOrder: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.");
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Payment gateway is not configured. Try again later." });
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const resp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(dueAmount * 100),
        currency: "INR",
        receipt: `cleardue_${rider.id}_${Date.now()}`,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      logger.error("createClearDueOrder: Razorpay API error:", data);
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
      due_amount: dueAmount,
    });
  } catch (err) {
    logger.error("createClearDueOrder failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function clearOutstandingDue(req, res) {
  try {
    const b = req.body || {};
    const mobile = String(b.mobile || "");
    const razorpayPaymentId = b.razorpay_payment_id;
    const razorpayOrderId = b.razorpay_order_id;
    const razorpaySignature = b.razorpay_signature;

    if (!mobile || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      return fail(res, "Missing Parameters");
    }

    const rider = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!rider) return fail(res, "No driver found with this mobile number!");

    // Never trust a client-supplied amount or receipt: re-fetch the order
    // from Razorpay itself and confirm it's the clear-due order this
    // specific rider's createClearDueOrder created (its receipt is tagged
    // `cleardue_<riderId>_...`). Without this check a driver could pay for
    // any order (e.g. a full-amount wallet recharge order, which the
    // generic /wallet/create-order endpoint still creates for any client
    // amount) and post its payment details here to credit their wallet by
    // whatever they paid - defeating the "drivers cannot self-recharge"
    // rule entirely.
    let order;
    try {
      order = await fetchRazorpayOrder(razorpayOrderId);
    } catch (e) {
      logger.error("clearOutstandingDue: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.", e);
      return res.status(200).json({ Result: false, msg: "Payment verification is not configured. Try again later." });
    }
    if (!order || !String(order.receipt || "").startsWith(`cleardue_${rider.id}_`)) {
      return fail(res, "This payment does not belong to your outstanding due.");
    }

    const paidAmount = Number(order.amount) / 100;

    let verification;
    try {
      verification = await verifyRazorpayPayment({
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
        signature: razorpaySignature,
        expectedAmountRupees: paidAmount,
      });
    } catch (e) {
      logger.error("clearOutstandingDue: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.", e);
      return res.status(200).json({ Result: false, msg: "Payment verification is not configured. Try again later." });
    }
    if (!verification.ok) return fail(res, verification.reason);

    // Clamp to the rider's *current* outstanding due, not the amount paid:
    // if the due shrank between order creation and payment (e.g. an admin
    // adjustment landed in between) this can never credit more than what's
    // actually owed, so the wallet can never be pushed positive by this
    // endpoint.
    const actualDue = Math.max(0, -Number(rider.wallet_balance || 0));
    if (actualDue <= 0) {
      return fail(res, "No outstanding dues to clear.");
    }
    const creditAmount = Math.min(paidAmount, actualDue);

    try {
      let newBalance = null;
      await prisma.$transaction(async (tx) => {
        await tx.tbl_wallet_history.create({
          data: {
            user_id: rider.id,
            mobile,
            amount: creditAmount,
            type: "credit",
            remark: "Outstanding Due Cleared",
            payment_id: razorpayPaymentId,
            razorpay_payment_id: razorpayPaymentId,
            wallet_type: "driver",
            created_at: istNow(),
          },
        });
        const updated = await tx.tbl_rider.update({ where: { id: rider.id }, data: { wallet_balance: { increment: creditAmount } } });
        newBalance = Number(updated.wallet_balance);
      });
      walletNotifier
        .notifyDriverWalletTransaction(rider.id, { type: "credit", amount: creditAmount, remark: "Outstanding Due Cleared" })
        .catch((err) => logger.error(`clearOutstandingDue: wallet notify failed for rider ${rider.id}:`, err));
      return res.status(200).json({ Result: true, msg: "Outstanding due cleared", balance: newBalance });
    } catch (e) {
      if (e.code === "P2002") return fail(res, "This payment has already been credited.");
      throw e;
    }
  } catch (err) {
    logger.error("customerWalletController.clearOutstandingDue failed:", err);
    return fail(res, "Internal server error");
  }
}

// --- Clear Outstanding Due with referral points (driver-only) ---
// Same due computation/clamping discipline as clearOutstandingDue above,
// but the payment instrument is the driver's own referral_points balance
// instead of a Razorpay payment. Partial clearing is allowed (mirrors the
// min(available, needed) capping pattern used for ride-discount and
// driver-plan-purchase point spending elsewhere) - a driver short on
// points clears what they can and still owes `remaining_due`.
async function clearDueWithPoints(req, res) {
  try {
    const mobile = String(req.body?.mobile || "");
    if (!mobile) return fail(res, "Missing Data");

    const rider = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!rider) return fail(res, "No driver found with this mobile number!");

    const actualDue = Math.max(0, -Number(rider.wallet_balance || 0));
    if (actualDue <= 0) return fail(res, "No outstanding dues to clear.");

    const settings = await prisma.tbl_referral_setting.findFirst();
    if (!settings || !settings.referral_enabled) {
      return fail(res, "Paying with referral points is not available right now.");
    }
    const pointValue = Number(settings.point_value) > 0 ? Number(settings.point_value) : 1;
    const pointsNeeded = Math.ceil(actualDue / pointValue);
    const pointsUsed = Math.min(Number(rider.referral_points) || 0, pointsNeeded);
    if (pointsUsed <= 0) return fail(res, "No referral points available.");

    const creditAmount = Math.min(actualDue, Math.round(pointsUsed * pointValue * 100) / 100);

    const result = await prisma.$transaction(async (tx) => {
      // Atomic guarded decrement: only proceeds if the points balance read
      // above still holds at commit time, so a concurrent spend of the
      // same points (another due-clear, a plan purchase, an admin debit)
      // can't double-spend them.
      const decremented = await tx.tbl_rider.updateMany({
        where: { id: rider.id, referral_points: { gte: pointsUsed } },
        data: { referral_points: { decrement: pointsUsed }, wallet_balance: { increment: creditAmount } },
      });
      if (decremented.count === 0) return null;

      const fresh = await tx.tbl_rider.findFirst({ where: { id: rider.id } });

      await tx.tbl_wallet_history.create({
        data: {
          user_id: rider.id,
          mobile,
          amount: creditAmount,
          type: "credit",
          remark: "Outstanding Due Cleared (Referral Points)",
          wallet_type: "driver",
          created_at: istNow(),
        },
      });
      await tx.tbl_referral_point_log.create({
        data: {
          user_id: rider.id,
          user_type: "DRIVER",
          points: -pointsUsed,
          txn_type: "debit",
          source: "due_clearance",
          balance_after: Number(fresh.referral_points),
          note: `Cleared ₹${creditAmount} outstanding due using ${pointsUsed} referral points`,
          created_at: new Date(),
        },
      });

      return { wallet_balance: Number(fresh.wallet_balance), referral_points: Number(fresh.referral_points) };
    });

    if (!result) return fail(res, "Referral point balance changed - please retry.");

    return res.status(200).json({
      Result: true,
      msg: "Outstanding due cleared using referral points",
      balance: result.wallet_balance,
      points_used: pointsUsed,
      remaining_due: Math.max(0, actualDue - creditAmount),
      referral_points: result.referral_points,
    });
  } catch (err) {
    logger.error("customerWalletController.clearDueWithPoints failed:", err);
    return fail(res, "Internal server error");
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

    if (walletType === "driver") {
      return fail(res, "Drivers cannot add money to their ledger.");
    }

    const maxTopup = await getCustomerWalletMaxTopup();
    if (amount > maxTopup) {
      return fail(res, `Maximum amount limit is ₹${maxTopup} per transaction`);
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
    const charge = Math.round(amount * 0.025 * 100) / 100;
    const netCredit = Math.round((amount - charge) * 100) / 100;

    let newBalance;
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Credit the recharge transaction
        await tx.tbl_wallet_history.create({
          data: {
            user_id: account.id,
            mobile,
            amount,
            type: "credit",
            remark: "Recharge via Razorpay",
            payment_id: razorpayPaymentId,
            razorpay_payment_id: razorpayPaymentId,
            wallet_type: walletType,
            created_at: istNow(),
          },
        });

        // 2. Debit the 2.5% Platform convenience fees
        await tx.tbl_wallet_history.create({
          data: {
            user_id: account.id,
            mobile,
            amount: charge,
            type: "debit",
            remark: "Platform convenience fees (2.5%)",
            wallet_type: walletType,
            created_at: istNow(),
          },
        });

        // 3. Increment user balance by netCredit (amount - 2.5% charge)
        const updated = await tx.tbl_user.update({
          where: { id: account.id },
          data: { wallet: { increment: netCredit } },
        });
        newBalance = Number(updated.wallet);
      });
    } catch (e) {
      if (e.code === "P2002") return fail(res, "This payment has already been credited.");
      throw e;
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
      const [pending, latest, maxDueLimit, minWithdrawalAmount, bankAccount] = await Promise.all([
        prisma.driver_withdraw_requests.aggregate({ where: { rider_id: userId, status: "pending" }, _sum: { amount: true } }),
        prisma.driver_withdraw_requests.findFirst({ where: { rider_id: userId }, orderBy: { id: "desc" }, select: { id: true, amount: true, status: true, created_at: true } }),
        getDriverMaxDueLimit(),
        getDriverMinWithdrawalAmount(),
        prisma.tbl_bank_account.findFirst({ where: { rider_id: userId } }),
      ]);
      const pendingAmount = Number(pending._sum.amount || 0);
      const balanceNum = Number(wallet || 0);
      const outstandingDue = Math.max(0, -balanceNum);
      // available_to_withdraw now nets out both the reserve (min_withdrawal_amount
      // must stay in the ledger, see withdrawWallet) and any pending payout -
      // this is the true ceiling withdrawWallet will accept.
      const availableToWithdraw = Math.max(0, balanceNum - pendingAmount - minWithdrawalAmount);
      withdrawalSummary = {
        pending_withdrawal_amount: pendingAmount.toFixed(2),
        available_to_withdraw: availableToWithdraw.toFixed(2),
        latest_withdrawal: latest ? { id: latest.id, amount: Number(latest.amount || 0).toFixed(2), status: latest.status, created_at: latest.created_at } : null,
        outstanding_due: outstandingDue.toFixed(2),
        max_due_limit: maxDueLimit,
        min_withdrawal_amount: minWithdrawalAmount,
        can_withdraw: availableToWithdraw > 0,
        can_clear_due: balanceNum < 0,
        due_limit_reached: balanceNum <= -maxDueLimit,
        payout_methods: {
          upi_id: account.upi_id || null,
          bank_account: bankAccount
            ? {
                bank_name: bankAccount.bank_name,
                account_name: bankAccount.a_name,
                ifsc_code: bankAccount.ifsc_code,
                account_number_masked: bankAccount.iban_num ? `•••${String(bankAccount.iban_num).slice(-4)}` : null,
              }
            : null,
        },
      };
    }
    const totalCredit = rows.filter((r) => r.type === "credit").reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalDebit = rows.filter((r) => r.type === "debit").reduce((s, r) => s + Number(r.amount || 0), 0);

    return res.status(200).json({
      Result: true,
      msg: walletType === "driver" ? "Ledger History" : "Wallet History",
      wallet_balance: wallet?.toString?.() ?? wallet,
      wallet_points: walletPoints,
      ...withdrawalSummary,
      total_credit: totalCredit,
      total_debit: totalDebit,
      data: rows.map((r) => ({
        ...r,
        // rows written before the rename still carry the old remark
        remark: r.remark === "Payment Gateway Charge (2.5%)" ? "Platform convenience fees (2.5%)" : r.remark,
        created_at: formatLedgerTime(r.created_at),
      })),
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
    const remark = b.remark || (walletType === "driver" ? "Ledger Withdraw" : "Wallet Withdraw");
    if (!mobile || !amount || !walletType) return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "Missing Data" });

    const account =
      walletType === "user"
        ? await prisma.tbl_user.findFirst({ where: { mobile: Number(mobile) } })
        : await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!account) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Mobile Not Found!" });
    }

    const currentBalance = Number(walletType === "user" ? account.wallet : account.wallet_balance || 0);

    // Driver withdrawals go through admin approval (payoutController.approve
    // does the actual debit) - the wallet is only ever touched once an admin
    // acts on the request, never here. A driver's withdrawal used to debit
    // immediately with no request row at all, which meant it never reached
    // the admin Payouts screen for approval (see incident: rider
    // 9999900001's ₹2 withdrawal went straight through with nobody
    // approving it) - reusing driver_withdraw_requests (the table the
    // Payouts page already reads) closes that gap instead of inventing a
    // second, parallel approval mechanism.
    if (walletType === "driver") {
      const isHeldForTrial = (account.trial_status === "active" || account.trial_status === "exhausted")
        && account.verification_status !== "approved";
      if (isHeldForTrial) {
        return res.status(200).json({
          ResponseCode: "403",
          Result: "false",
          ResponseMsg: "Your earnings are held until you complete KYC verification. Please finish your registration to withdraw.",
        });
      }

      if (currentBalance <= 0) {
        return res.status(200).json({ ResponseCode: "403", Result: "false", ResponseMsg: "No withdrawable balance. Clear your outstanding dues first." });
      }
      const reserve = await getDriverMinWithdrawalAmount();
      const pendingAgg = await prisma.driver_withdraw_requests.aggregate({
        where: { rider_id: account.id, status: "pending" },
        _sum: { amount: true },
      });
      const pendingAmount = Number(pendingAgg._sum.amount || 0);
      // reserve stays in the ledger permanently; pendingAmount is already
      // earmarked by an earlier request still awaiting admin action - both
      // must come off what's left to request again.
      const maxWithdrawable = Math.max(0, currentBalance - reserve - pendingAmount);
      if (maxWithdrawable <= 0) {
        return res.status(200).json({
          ResponseCode: "404",
          Result: "false",
          ResponseMsg: pendingAmount > 0
            ? `You already have ₹${pendingAmount} pending approval. Nothing further is available to request right now.`
            : `₹${reserve} must stay in your ledger. Current balance ₹${currentBalance}.`,
        });
      }
      if (amount > maxWithdrawable) {
        return res.status(200).json({
          ResponseCode: "404",
          Result: "false",
          ResponseMsg: `You can request up to ₹${maxWithdrawable} right now - ₹${reserve} must stay in your ledger${pendingAmount > 0 ? `, and ₹${pendingAmount} is already pending approval` : ""}.`,
        });
      }

      // Payout method: the driver either withdraws to whatever UPI id / bank
      // account is already saved on their profile, or supplies a fresh one
      // here to update it first - same upsert pattern as
      // driverKycController.saveBankAccount. The resolved method/detail is
      // snapshotted onto the request row (not just the driver's profile) so
      // admin sees exactly what was chosen even if the saved profile changes
      // before the request is approved.
      let payoutMethod = null;
      let payoutDetailText = null;
      if (b.payout_method) {
        const method = String(b.payout_method).toLowerCase();
        if (method === "upi") {
          let upiId = b.upi_id ? String(b.upi_id).trim() : "";
          if (upiId) {
            await prisma.tbl_rider.update({ where: { id: account.id }, data: { upi_id: upiId } });
          } else {
            const rider = await prisma.tbl_rider.findUnique({ where: { id: account.id }, select: { upi_id: true } });
            upiId = rider?.upi_id || "";
          }
          if (!upiId) {
            return res.status(200).json({ ResponseCode: "405", Result: "false", ResponseMsg: "Add a UPI ID before withdrawing." });
          }
          payoutMethod = "upi";
          payoutDetailText = `UPI (${upiId})`;
        } else if (method === "bank") {
          const accountName = b.account_name;
          const accountNumber = b.account_number;
          const ifscCode = b.ifsc_code;
          const bankName = b.bank_name;
          if (accountName && accountNumber && bankName) {
            const existing = await prisma.tbl_bank_account.findFirst({ where: { rider_id: account.id } });
            const data = {
              a_name: accountName,
              iban_num: accountNumber,
              bank_name: bankName,
              ifsc_code: ifscCode || existing?.ifsc_code || null,
              status: 0,
            };
            if (existing) {
              await prisma.tbl_bank_account.update({ where: { id: existing.id }, data });
            } else {
              await prisma.tbl_bank_account.create({ data: { rider_id: account.id, branch_name: "", vat_id: "", ...data } });
            }
          }
          const bank = await prisma.tbl_bank_account.findFirst({ where: { rider_id: account.id } });
          if (!bank) {
            return res.status(200).json({ ResponseCode: "405", Result: "false", ResponseMsg: "Add your bank account before withdrawing." });
          }
          const maskedAcc = bank.iban_num ? `•••${String(bank.iban_num).slice(-4)}` : "";
          payoutMethod = "bank";
          payoutDetailText = `Bank ${bank.bank_name || ""} (${maskedAcc})`.trim();
        } else {
          return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "Invalid payout method." });
        }
      }

      const request = await prisma.driver_withdraw_requests.create({
        data: {
          rider_id: account.id,
          amount,
          status: "pending",
          city_id: account.city_id ?? null,
          payout_method: payoutMethod,
          payout_detail: payoutDetailText,
        },
      });

      return res.status(200).json({
        ResponseCode: "200",
        Result: "true",
        ResponseMsg: "Withdrawal request submitted. It will be paid out once an admin approves it.",
        request_id: request.id,
      });
    }

    if (currentBalance < amount) {
      return res.status(200).json({ ResponseCode: "402", Result: "false", ResponseMsg: "Insufficient Balance!" });
    }

    // Atomic conditional debit (customer wallet only - driver withdrawals
    // are handled above via the pending-request path): the WHERE clause
    // re-checks the balance at commit time instead of trusting the
    // currentBalance read above, so two concurrent withdraw calls for the
    // same account can no longer both pass (see
    // customerWalletController.withdrawWallet race - fixed 2026-09-23).
    let debited = false;
    let newBalance = null;
    await prisma.$transaction(async (tx) => {
      const result = await tx.tbl_user.updateMany({
        where: { id: account.id, wallet: { gte: amount } },
        data: { wallet: { decrement: amount } },
      });
      if (result.count === 0) return;
      debited = true;
      await tx.tbl_wallet_history.create({
        data: { user_id: account.id, mobile, amount, type: "debit", remark, wallet_type: walletType, created_at: istNow() },
      });
      // Re-read the balance inside the same transaction instead of trusting
      // currentBalance - amount: a successful updateMany only proves the
      // balance was >= amount at commit time, not that it was unchanged
      // since the read above, so the pre-transaction arithmetic can be
      // wrong even when this withdrawal itself is entirely valid.
      const fresh = await tx.tbl_user.findFirst({ where: { id: account.id } });
      newBalance = Number(fresh.wallet);
    });

    if (!debited) {
      return res.status(200).json({ ResponseCode: "402", Result: "false", ResponseMsg: "Insufficient Balance!" });
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Withdraw Successful!", NewBalance: newBalance });
  } catch (err) {
    logger.error("customerWalletController.withdrawWallet failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { addWallet, walletHistory, withdrawWallet, createRazorpayOrder, createClearDueOrder, clearOutstandingDue, clearDueWithPoints };
