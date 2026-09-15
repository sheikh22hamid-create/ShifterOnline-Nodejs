const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { getAdvancePaymentTimerInfo } = require("../utils/advancePaymentTimer");

// Node port of rider_api/pkg_history.php - the driver's order history /
// "Trip Payment Details" screen. Ported carefully rather than skipped
// despite its size: the PHP source carries detailed inline comments
// documenting real production bugs it was fixed for after the Node
// migration (orders #1620/#1621, #1784, #1819) tied to exactly how
// services/tripLifecycle.js writes commission/advance_payment/driver_earning
// on completion - so the display math here is kept identical to what that
// file already computes and stores, not re-derived independently.
//
// advance_payment, minimum_charge, pickup_charge, distance_charge,
// night_charge, admin_amount are real columns on pkg_order but aren't in
// this repo's Prisma schema (same gap tripLifecycle.js itself works around
// with $queryRaw for advance_payment) - fetched via $queryRaw here for the
// same reason.
//
// The inline "auto-cancel expired advance-payment orders" check the PHP
// ran on every history fetch is now a proper periodic sweep instead —
// see tripLifecycle.sweepExpiredAdvancePayments (wired into server.js) -
// so it's not repeated here on every request.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

// --- rider_api/pkg_history.php ---
async function pkgHistoryDriver(req, res) {
  try {
    const rid = Number(req.body?.rid || 0);
    const type = req.body?.type;
    if (!rid) return fail(res, "Something Went Wrong!");

    let rows;
    if (type === "past") {
      rows = await prisma.$queryRaw`
        SELECT * FROM pkg_order WHERE rid = ${rid} AND (o_status = 'Completed' OR o_status = 'Cancelled') ORDER BY id DESC
      `;
    } else {
      const rejected = await prisma.reject_rider_list.findMany({ where: { rid, type: "package" }, select: { order_id: true } });
      const rejectedIds = rejected.map((r) => r.order_id);
      rows = await prisma.$queryRaw`
        SELECT * FROM pkg_order
        WHERE rid = ${rid}
          AND o_status NOT IN ('Completed', 'Cancelled')
          AND id NOT IN (${rejectedIds.length ? Prisma.join(rejectedIds) : Prisma.raw("0")})
        ORDER BY id DESC
      `;
    }

    if (!rows.length) {
      return res.status(200).json({ OrderHistory: [], ResponseCode: "200", Result: "true", ResponseMsg: "No Active Orders" });
    }

    const setting = await prisma.setting.findFirst({ select: { rider_commission: true } }).catch(() => null);
    const globalComm = Number(setting?.rider_commission ?? 10);

    const orderIds = rows.map((r) => Number(r.id));
    const stops = await prisma.pkg_order_stops.findMany({ where: { order_id: { in: orderIds } }, orderBy: { sequence: "asc" } });
    const stopsByOrder = {};
    for (const s of stops) {
      (stopsByOrder[s.order_id] ||= []).push({
        sequence: s.sequence,
        lat: s.lat,
        lng: s.lng,
        address: s.address,
        hno: s.hno,
        landmark: s.landmark,
        contact_name: s.contact_name,
        contact_number: s.contact_number,
      });
    }

    const benefitLogs = await prisma.tbl_plan_benefit_log.findMany({
      where: { ride_id: { in: orderIds }, plan_for: "DRIVER" },
    });
    const planNameCache = {};
    for (const log of benefitLogs) {
      if (!(log.plan_id in planNameCache)) {
        const plan = await prisma.tbl_premium_plan.findUnique({ where: { id: log.plan_id }, select: { plan_name: true } });
        planNameCache[log.plan_id] = plan?.plan_name || null;
      }
    }
    const benefitByOrder = Object.fromEntries(benefitLogs.map((b) => [Number(b.ride_id), b]));

    const history = rows.map((row) => {
      const timerInfo = getAdvancePaymentTimerInfo(row);
      const isPaid = Number(row.payment_status || 0) === 1;
      const isAdvRequired = isPaid ? false : timerInfo.is_advance_required;

      const fare = Number(row.total_dcharge) > 0 ? Number(row.total_dcharge) : Number(row.d_charge || 0);

      let commPct;
      if (row.o_status === "Completed" && row.commission !== null && row.commission !== "") {
        commPct = Number(row.commission);
      } else if (row.commission != null && Number(row.commission) > 0) {
        commPct = Number(row.commission);
      } else {
        commPct = globalComm;
      }

      let adminAmount = Number(row.admin_amount || 0);
      if (adminAmount <= 0 && fare > 0) {
        adminAmount = Math.round(((fare * commPct) / 100) * 100) / 100; // round(fare * commPct / 100, 2)
      }

      const advPay = Number(row.advance_payment || 0);
      const transId = String(row.trans_id || "").toLowerCase();
      const isCashOrder = transId.startsWith("cash");
      const driverEarning = Math.max(0, Number((fare - adminAmount).toFixed(2)));
      const cashCollect = Math.max(0, Number((fare - advPay).toFixed(2)));

      const walletDiff = Number((driverEarning - cashCollect).toFixed(2));
      let walletAction = "none";
      let walletAdj = 0;
      let adjNote;
      if (walletDiff < 0) {
        walletAction = "debit";
        walletAdj = Math.abs(walletDiff);
        adjNote = `Driver earning ₹${driverEarning.toFixed(2)}. Cash collected ₹${cashCollect.toFixed(2)}. ₹${walletAdj.toFixed(2)} debited from wallet.`;
      } else if (walletDiff > 0) {
        walletAction = "add";
        walletAdj = walletDiff;
        adjNote = `Driver earning ₹${driverEarning.toFixed(2)}. Cash collected ₹${cashCollect.toFixed(2)}. ₹${walletAdj.toFixed(2)} added to wallet.`;
      } else {
        adjNote = `Driver earning ₹${driverEarning.toFixed(2)} settled completely via cash collected.`;
      }

      const benefit = row.o_status === "Completed" ? benefitByOrder[Number(row.id)] : null;
      const planName = benefit ? planNameCache[benefit.plan_id] : null;
      const planDiscountApplied = benefit ? Number(benefit.discount_applied) : 0;
      const planIncentiveEarned = benefit ? Number(benefit.incentive_earned) : 0;

      return {
        id: row.id,
        order_user_id: row.uid,
        status: row.o_status,
        order_date: row.odate,
        total: row.d_charge,
        pick_name: row.pick_name,
        drop_name: row.drop_name,
        time_duration: row.time_duration,
        order_flow_id: row.order_status,
        advance_payment: timerInfo.advance_payment,
        payment_status: isPaid ? 1 : 0,
        is_advance_payment_required: isAdvRequired,
        is_advance_required: isAdvRequired,
        advance_payment_timer: isAdvRequired ? timerInfo.remaining_seconds : 0,
        remaining_seconds: isAdvRequired ? timerInfo.remaining_seconds : 0,
        advance_payment_msg: isAdvRequired ? "Customer advance payment is pending. Please wait for customer to complete the payment." : "",
        accept_time: timerInfo.accept_time,
        // Same defensive '' -> '0' coercion the PHP added for
        // plat/plong/dlat/dlong - the driver app's model parses these as
        // primitive doubles and throws on an empty string, which used to
        // abort parsing the WHOLE OrderHistory array, not just this row.
        plat: row.plat || "0",
        plong: row.plong || "0",
        dlat: row.dlat || "0",
        dlong: row.dlong || "0",
        stops: stopsByOrder[Number(row.id)] || [],
        customer_paddress: row.paddress,
        customer_pmobile: row.pmobile,
        customer_daddress: row.daddress,
        customer_dmobile: row.dmobile,
        pick_type: row.pick_type,
        drop_type: row.drop_type,
        description: row.description,
        distance: row.distance,
        loading_charge: row.loading_charge,
        unloading_charge: row.unloading_charge,
        service_charge: row.service_charge,
        wating_charge: row.wating_charge,
        free_waiting_time: row.free_waiting_time,
        radius_range: row.radius_range,
        radius_charge: row.radius_charge,
        final_fare_amount: fare,
        driver_total_earning: driverEarning,
        driver_earning: driverEarning,
        commission: adminAmount,
        commission_amount: adminAmount,
        commission_percent: commPct,
        per_trip_charge: 0,
        total_deductions: adminAmount,
        admin_amount: adminAmount,
        total_amount_by_user: fare,
        cash_to_collect: cashCollect,
        cash_collected_from_user: cashCollect,
        wallet_adjustment: walletAdj,
        wallet_adjustment_note: adjNote,
        plan_benefit_applied: planName !== null,
        plan_name: planName,
        plan_discount_applied: planDiscountApplied,
        plan_incentive_earned: planIncentiveEarned,
        trip_payment_summary: {
          fare_breakdown: {
            minimum_charge: Number(row.minimum_charge || 0),
            actual_pickup_charge: Number(row.pickup_charge || 0),
            pickup_to_drop_charge: Number(row.distance_charge || row.d_charge || 0),
            add_stop_charge: 0,
            extra_waiting_time_charge: Number(row.wating_charge || 0),
            night_charge: Number(row.night_charge || 0),
            loading_charge: Number(row.loading_charge || 0),
            unloading_charge: Number(row.unloading_charge || 0),
            service_charge: Number(row.service_charge || 0),
            extra_mile_charge: Number(row.extra_mile_charge || 0),
            plan_discount_applied: planDiscountApplied,
            final_fare_amount: fare,
          },
          deductions: {
            commission_percent: commPct,
            commission: adminAmount,
            per_trip_charge: 0,
            total_deductions: adminAmount,
            driver_total_earning: driverEarning,
          },
          payment_by_user: { total_amount_by_user: fare, advance_payment: advPay, cash_to_collect: cashCollect },
          final_settlement: {
            driver_total_earning: driverEarning,
            cash_collected_from_user: cashCollect,
            wallet_adjustment: walletAdj,
            wallet_adjustment_action: walletAction,
            note: adjNote,
          },
        },
      };
    });

    return res.status(200).json({ OrderHistory: history, ResponseCode: "200", Result: "true", ResponseMsg: "Order History Get Successfully!!!" });
  } catch (err) {
    logger.error("driverOrderHistoryController.pkgHistoryDriver failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

module.exports = { pkgHistoryDriver };
