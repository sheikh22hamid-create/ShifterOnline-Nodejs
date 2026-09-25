const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseDateRange(query) {
  const { start_date, end_date, period } = query;
  const now = new Date();

  if (period) {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    switch (period) {
      case "today":
        return { start: todayStart, end: todayEnd, label: "Today" };
      case "yesterday": {
        const yStart = new Date(todayStart);
        yStart.setDate(yStart.getDate() - 1);
        const yEnd = new Date(todayEnd);
        yEnd.setDate(yEnd.getDate() - 1);
        return { start: yStart, end: yEnd, label: "Yesterday" };
      }
      case "7days": {
        const d7 = new Date(todayStart);
        d7.setDate(d7.getDate() - 6);
        return { start: d7, end: todayEnd, label: "Last 7 Days" };
      }
      case "30days": {
        const d30 = new Date(todayStart);
        d30.setDate(d30.getDate() - 29);
        return { start: d30, end: todayEnd, label: "Last 30 Days" };
      }
      case "this_month": {
        const mStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        return { start: mStart, end: todayEnd, label: "This Month" };
      }
      case "last_month": {
        const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
        const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        return { start: lmStart, end: lmEnd, label: "Last Month" };
      }
      case "this_quarter": {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const qStart = new Date(now.getFullYear(), currentQuarter * 3, 1, 0, 0, 0);
        return { start: qStart, end: todayEnd, label: `Quarter ${currentQuarter + 1}` };
      }
      case "all": {
        return { start: new Date("2020-01-01T00:00:00"), end: todayEnd, label: "All Time" };
      }
      default:
        break;
    }
  }

  if (start_date && end_date) {
    const start = new Date(`${start_date}T00:00:00`);
    const end = new Date(`${end_date}T23:59:59.999`);
    return { start, end, label: `${start_date} to ${end_date}` };
  }

  // Default: This month
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const mEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start: mStart, end: mEnd, label: "This Month" };
}

/**
 * GET /api/admin/finance/ledger
 * Comprehensive multi-party financial ledger and P&L report
 */
async function getLedgerOverview(req, res) {
  try {
    const { start, end, label } = parseDateRange(req.query);
    const scopedCityId =
      req.user.role === "superadmin"
        ? req.query.city_id
          ? Number(req.query.city_id)
          : null
        : parseInt(req.user.city_id, 10);

    const cityOrderFilter = scopedCityId ? Prisma.sql`AND city_id = ${scopedCityId}` : Prisma.empty;
    const cityRiderFilter = scopedCityId ? Prisma.sql`AND city_id = ${scopedCityId}` : Prisma.empty;
    const cityWithdrawFilter = scopedCityId ? Prisma.sql`AND city_id = ${scopedCityId}` : Prisma.empty;

    // 1. Completed Orders in date range
    // Calculates GMV, Platform Commission, Driver Gross Earnings, Online vs Cash breakdown
    const [orderAggRows] = await prisma.$queryRaw`
      SELECT
        COUNT(*) AS completed_count,
        COALESCE(SUM(total_dcharge), 0) AS total_gmv,
        COALESCE(SUM(d_charge), 0) AS sum_d_charge,
        COALESCE(SUM(driver_earning), 0) AS sum_driver_earning,
        COALESCE(SUM((d_charge * commission / 100) + COALESCE(package_cost, 0)), 0) AS sum_commission_revenue,
        COALESCE(SUM(CASE WHEN p_method_id = 1 OR p_method_id IS NULL THEN total_dcharge ELSE 0 END), 0) AS cash_gmv,
        COALESCE(SUM(CASE WHEN p_method_id != 1 AND p_method_id IS NOT NULL THEN total_dcharge ELSE 0 END), 0) AS online_gmv,
        COALESCE(SUM(CASE WHEN p_method_id = 1 OR p_method_id IS NULL THEN (d_charge * commission / 100) + COALESCE(package_cost, 0) ELSE 0 END), 0) AS commission_from_cash,
        COALESCE(SUM(CASE WHEN p_method_id != 1 AND p_method_id IS NOT NULL THEN (d_charge * commission / 100) + COALESCE(package_cost, 0) ELSE 0 END), 0) AS commission_from_online,
        COALESCE(SUM(CASE WHEN advance_payment IS NOT NULL AND advance_payment != '' THEN CAST(advance_payment AS DECIMAL(10,2)) ELSE 0 END), 0) AS advance_in_completed
      FROM pkg_order
      WHERE o_status = 'Completed'
        AND odate BETWEEN ${start} AND ${end}
        ${cityOrderFilter}
    `;

    // 2. Active Orders currently in progress (Current Advance Deposit Liability)
    const [activeAdvanceRows] = await prisma.$queryRaw`
      SELECT
        COUNT(*) AS active_count,
        COALESCE(SUM(CASE WHEN advance_payment IS NOT NULL AND advance_payment != '' THEN CAST(advance_payment AS DECIMAL(10,2)) ELSE 0 END), 0) AS active_advance_liability
      FROM pkg_order
      WHERE o_status NOT IN ('Completed', 'Cancelled')
        AND order_status IN (0, 1, 2, 3)
        ${cityOrderFilter}
    `;

    // 3. Cancelled Orders in date range (Cancellation Charges & Refunds)
    const [cancelledRows] = await prisma.$queryRaw`
      SELECT
        COUNT(*) AS cancelled_count,
        COALESCE(SUM(COALESCE(cancel_charge, 0)), 0) AS cancellation_income,
        COALESCE(SUM(COALESCE(distance_refund, 0)), 0) AS distance_refunds_owed
      FROM pkg_order
      WHERE o_status = 'Cancelled'
        AND odate BETWEEN ${start} AND ${end}
        ${cityOrderFilter}
    `;

    // 4. Customer Wallet Balance (Current Balance Sheet Liability)
    // Note: tbl_user wallet is nationwide, but if city-scoped, we respect city_id if set
    const userCityFilter = scopedCityId ? Prisma.sql`WHERE city_id = ${scopedCityId}` : Prisma.empty;
    const [customerWalletRows] = await prisma.$queryRaw`
      SELECT
        COUNT(CASE WHEN wallet > 0 THEN 1 END) AS positive_wallet_users,
        COALESCE(SUM(CASE WHEN wallet > 0 THEN wallet ELSE 0 END), 0) AS total_customer_wallet_liability
      FROM tbl_user
      ${userCityFilter}
    `;

    // 5. Driver Accounts: Sundry Debtors, Sundry Creditors & Wallet balances
    const riderWhereCity = scopedCityId ? Prisma.sql`WHERE city_id = ${scopedCityId}` : Prisma.empty;
    const [driverWalletRows] = await prisma.$queryRaw`
      SELECT
        COUNT(CASE WHEN wallet_balance > 0 THEN 1 END) AS creditors_count,
        COALESCE(SUM(CASE WHEN wallet_balance > 0 THEN wallet_balance ELSE 0 END), 0) AS sundry_creditors_payable,
        COUNT(CASE WHEN wallet_balance < 0 THEN 1 END) AS debtors_count,
        COALESCE(SUM(CASE WHEN wallet_balance < 0 THEN ABS(wallet_balance) ELSE 0 END), 0) AS sundry_debtors_receivable
      FROM tbl_rider
      ${riderWhereCity}
    `;

    // 6. Driver Withdrawal Requests (Pending vs Approved Payouts in period)
    const [payoutRows] = await prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_settlement_payouts,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_payout_count,
        COALESCE(SUM(CASE WHEN status = 'approved' AND (created_at BETWEEN ${start} AND ${end}) THEN amount ELSE 0 END), 0) AS approved_settled_payouts,
        COUNT(CASE WHEN status = 'approved' AND (created_at BETWEEN ${start} AND ${end}) THEN 1 END) AS approved_payout_count
      FROM driver_withdraw_requests
      WHERE 1=1
        ${cityWithdrawFilter}
    `;

    // 7. Recent Transaction Journal Entries (Limit 35 for ledger table)
    const recentOrders = await prisma.pkg_order.findMany({
      where: {
        odate: { gte: start, lte: end },
        ...(scopedCityId ? { city_id: scopedCityId } : {}),
      },
      orderBy: { id: "desc" },
      take: 50,
      select: {
        id: true,
        odate: true,
        o_status: true,
        order_status: true,
        total_dcharge: true,
        d_charge: true,
        commission: true,
        driver_earning: true,
        cancel_charge: true,
        advance_payment: true,
        p_method_id: true,
        razorpay_payment_id: true,
        trans_id: true,
        pick_name: true,
        drop_name: true,
        category: true,
        uid: true,
        rid: true,
      },
    });

    // Populate user and rider names for journal
    const uids = [...new Set(recentOrders.map((o) => o.uid).filter(Boolean))];
    const rids = [...new Set(recentOrders.map((o) => o.rid).filter(Boolean))];

    const [users, riders, paymentMethods] = await Promise.all([
      prisma.tbl_user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, mobile: true } }),
      prisma.tbl_rider.findMany({ where: { id: { in: rids } }, select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true } }),
      prisma.tbl_payment_list.findMany({ select: { id: true, title: true } }),
    ]);

    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    const riderMap = Object.fromEntries(
      riders.map((r) => [r.id, r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`])
    );
    const pmMap = Object.fromEntries(paymentMethods.map((p) => [p.id, p.title]));

    // Financial calculations
    const completedOrders = Number(orderAggRows?.completed_count || 0);
    const totalGmv = round2(orderAggRows?.total_gmv || 0);
    const sumDCharge = round2(orderAggRows?.sum_d_charge || 0);
    const commissionRevenue = round2(orderAggRows?.sum_commission_revenue || 0);
    const cancellationIncome = round2(cancelledRows?.cancellation_income || 0);
    const onlineGmv = round2(orderAggRows?.online_gmv || 0);
    const cashGmv = round2(orderAggRows?.cash_gmv || 0);
    const commissionFromCash = round2(orderAggRows?.commission_from_cash || 0);
    const commissionFromOnline = round2(orderAggRows?.commission_from_online || 0);

    // Driver Gross Share
    // If driver_earning is stored, use it; otherwise gross fare minus commission
    const driverGrossEarnings = round2(
      Number(orderAggRows?.sum_driver_earning) > 0
        ? orderAggRows.sum_driver_earning
        : Math.max(0, totalGmv - commissionRevenue)
    );

    // 194-O TDS: 1% statutory deduction on Gross Driver Earnings / Services facilitated
    const tds194oDriver = round2(driverGrossEarnings * 0.01);

    // GST Output on Platform Commission: 18% (SAC 9965 / 9967 Aggregator Services)
    const gstOutputOnCommission = round2(commissionRevenue * 0.18);

    // Payment Gateway charges (Razorpay): standard ~2% on online collections
    const razorpayPgCharges = round2(onlineGmv * 0.02);

    // Input Tax Credit (ITC): 18% GST portion of payment gateway charges
    // (Razorpay invoices GST @ 18% on their 2% fee; platform claims this ITC)
    const inputTaxCredit = round2(razorpayPgCharges * 0.18);

    // Net GST Payable to Government
    const netGstPayable = round2(Math.max(0, gstOutputOnCommission - inputTaxCredit));

    // Platform Net Profit
    // Gross Revenue (Commission + Cancellation) - PG Charges - Net Tax
    const grossPlatformRevenue = round2(commissionRevenue + cancellationIncome);
    const totalDirectExpenses = round2(razorpayPgCharges);
    const netOperatingProfit = round2(grossPlatformRevenue - totalDirectExpenses);
    const profitMarginPercent = totalGmv > 0 ? round2((netOperatingProfit / totalGmv) * 100) : 0;

    // Customer-Side Accounts
    const advanceBookingLiability = round2(activeAdvanceRows?.active_advance_liability || 0);
    const customerWalletBalance = round2(customerWalletRows?.total_customer_wallet_liability || 0);
    const refundsPayable = round2(cancelledRows?.distance_refunds_owed || 0);
    const totalCustomerLiabilities = round2(advanceBookingLiability + customerWalletBalance + refundsPayable);

    // Driver-Side Accounts
    const platformCommissionReceivable = commissionFromCash; // Commission accrued on cash rides collected by driver
    const sundryDebtorsDriver = round2(driverWalletRows?.sundry_debtors_receivable || 0); // Negative wallet drivers
    const sundryCreditorsDriver = round2(driverWalletRows?.sundry_creditors_payable || 0); // Positive wallet drivers
    const pendingSettlementPayouts = round2(payoutRows?.pending_settlement_payouts || 0);
    const totalDriverSettlementPayable = round2(sundryCreditorsDriver + pendingSettlementPayouts);

    // Bank / Nodal Account Float estimation
    // Inflows (Online collections + Wallet deposits) - Outflows (Settled payouts + PG fees + Refunds)
    const settledPayouts = round2(payoutRows?.approved_settled_payouts || 0);
    const bankNodalEstimatedFloat = round2(
      Math.max(0, onlineGmv + advanceBookingLiability - settledPayouts - razorpayPgCharges - refundsPayable)
    );

    // Build Journal Rows
    const journalEntries = recentOrders.map((o) => {
      const isCompleted = o.o_status === "Completed";
      const isCancelled = o.o_status === "Cancelled";
      const fare = Number(o.total_dcharge || o.d_charge || 0);
      const isCash = o.p_method_id === 1 || !o.p_method_id;
      const commPct = Number(o.commission || 0);
      const orderCommission = isCompleted ? round2((fare * commPct) / 100) : 0;
      const orderGst = round2(orderCommission * 0.18);
      const orderDriverGross = isCompleted
        ? round2(Number(o.driver_earning) > 0 ? Number(o.driver_earning) : Math.max(0, fare - orderCommission))
        : 0;
      const orderTds = round2(orderDriverGross * 0.01);
      const orderPgFee = !isCash && isCompleted ? round2(fare * 0.02) : 0;
      const orderNetProfit = isCompleted ? round2(orderCommission - orderPgFee) : (isCancelled ? Number(o.cancel_charge || 0) : 0);

      const user = userMap[o.uid];
      const driverName = riderMap[o.rid] || (o.rid ? `Driver #${o.rid}` : "Unassigned");
      const payTitle = pmMap[o.p_method_id] || (isCash ? "Cash" : "Online / PG");

      return {
        id: o.id,
        booking_id: `SO${String(o.id).padStart(6, "0")}`,
        date: o.odate,
        status: o.o_status,
        customer_name: user?.name || o.pick_name || `User #${o.uid}`,
        customer_mobile: user?.mobile || "",
        driver_name: driverName,
        payment_mode: payTitle,
        is_cash: isCash,
        fare_gmv: fare,
        driver_gross: orderDriverGross,
        platform_commission: orderCommission,
        gst_output: orderGst,
        tds_194o: orderTds,
        pg_fee: orderPgFee,
        net_profit: orderNetProfit,
        advance_paid: Number(o.advance_payment || 0),
        cancel_charge: Number(o.cancel_charge || 0),
        category: o.category,
      };
    });

    return res.status(200).json({
      success: true,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        label,
      },
      summary: {
        total_gmv: totalGmv,
        completed_orders: completedOrders,
        cancelled_orders: Number(cancelledRows?.cancelled_count || 0),
        active_orders: Number(activeAdvanceRows?.active_count || 0),
        gross_platform_revenue: grossPlatformRevenue,
        commission_income: commissionRevenue,
        cancellation_income: cancellationIncome,
        direct_expenses: totalDirectExpenses,
        net_operating_profit: netOperatingProfit,
        profit_margin_percent: profitMarginPercent,
        bank_nodal_float: bankNodalEstimatedFloat,
      },
      // 1. Customer-Side Accounts
      customer_accounts: {
        advance_deposit_received: {
          code: "A/C-CUST-ADV-201",
          name: "Advance / Booking Deposit Received A/c",
          type: "Current Liability",
          balance: advanceBookingLiability,
          period_flow: round2(orderAggRows?.advance_in_completed || 0),
          description: "Advance payments collected on active/unfulfilled bookings",
        },
        customer_wallet_balance: {
          code: "A/C-CUST-WAL-202",
          name: "Customer Wallet Balance A/c",
          type: "Current Liability",
          balance: customerWalletBalance,
          positive_users_count: Number(customerWalletRows?.positive_wallet_users || 0),
          description: "Unspent stored value & credits in user accounts",
        },
        refunds_payable: {
          code: "A/C-CUST-REF-203",
          name: "Refunds Payable A/c",
          type: "Current Liability",
          balance: refundsPayable,
          description: "Refunds due to customers for cancelled or adjusted trips",
        },
        total_customer_liabilities: totalCustomerLiabilities,
      },
      // 2. Driver-Side Accounts
      driver_accounts: {
        driver_earnings_payable: {
          code: "A/C-DRV-PAY-204",
          name: "Driver Earnings Payable A/c",
          type: "Current Liability",
          balance: driverGrossEarnings,
          description: "Gross trip earnings earned by fleet partners for completed rides",
        },
        platform_commission_receivable: {
          code: "A/C-DRV-COMM-102",
          name: "Platform Commission Receivable A/c",
          type: "Current Asset",
          balance: platformCommissionReceivable,
          description: "Platform fee collected by drivers on cash trips, to be recovered",
        },
        driver_wallet_settlement: {
          code: "A/C-DRV-SETTLE-205",
          name: "Driver Wallet / Settlement A/c (Razorpay-linked)",
          type: "Current Liability / Clearing",
          balance: sundryCreditorsDriver,
          pending_payouts: pendingSettlementPayouts,
          settled_in_period: settledPayouts,
          description: "Withdrawable driver balance queued for Razorpay Route / Bank dispatch",
        },
        tds_194o_deducted: {
          code: "A/C-DRV-TDS-206",
          name: "TDS Deducted (Driver) A/c — Section 194-O",
          type: "Statutory Liability (Income Tax)",
          rate: "1%",
          balance: tds194oDriver,
          description: "E-Commerce operator TDS @ 1% under Sec 194-O to deposit with Govt",
        },
        sundry_debtors: {
          code: "A/C-DRV-DEBT-103",
          name: "Sundry Debtors — Driver (Negative Balances)",
          type: "Current Asset / Receivables",
          balance: sundryDebtorsDriver,
          count: Number(driverWalletRows?.debtors_count || 0),
          description: "Unrecovered commission from drivers with negative wallet balance",
        },
        sundry_creditors: {
          code: "A/C-DRV-CRED-207",
          name: "Sundry Creditors — Driver (Net Payable Pending)",
          type: "Current Liability / Payables",
          balance: sundryCreditorsDriver,
          count: Number(driverWalletRows?.creditors_count || 0),
          description: "Net dues payable to drivers whose balance is positive",
        },
      },
      // 3. Company-Side Accounts
      company_accounts: {
        platform_commission_income: {
          code: "A/C-CO-REV-401",
          name: "Platform Fee / Commission Income A/c",
          type: "Direct Operating Revenue",
          balance: commissionRevenue,
          cash_portion: commissionFromCash,
          online_portion: commissionFromOnline,
          description: "Core take-rate commission earned on completed shipments",
        },
        cancellation_charges_income: {
          code: "A/C-CO-REV-402",
          name: "Cancellation Charges Income A/c",
          type: "Other Operating Revenue",
          balance: cancellationIncome,
          description: "Trip cancellation penalty charges retained by platform",
        },
        gst_output_commission: {
          code: "A/C-CO-GST-208",
          name: "GST Output on Commission A/c (18%)",
          type: "Duties & Taxes Liability",
          rate: "18%",
          balance: gstOutputOnCommission,
          description: "GST collected @ 18% on platform commission payable to CBIC",
        },
        input_tax_credit: {
          code: "A/C-CO-ITC-104",
          name: "Input Tax Credit (ITC) A/c",
          type: "Tax Credit Asset",
          balance: inputTaxCredit,
          description: "GST paid on Razorpay payment gateway fees claimable as offset",
        },
        net_gst_payable: {
          code: "A/C-CO-NETGST-209",
          name: "Net GST Payable to Govt",
          type: "Net Tax Liability",
          balance: netGstPayable,
          description: "Output GST liability less Input Tax Credit",
        },
        bank_nodal_account: {
          code: "A/C-CO-BANK-101",
          name: "Bank / Nodal (Escrow) Account",
          type: "Cash & Cash Equivalents",
          balance: bankNodalEstimatedFloat,
          description: "Estimated liquid float in Nodal/Current bank account",
        },
        razorpay_gateway_charges: {
          code: "A/C-CO-EXP-501",
          name: "Razorpay Payment Gateway Charges A/c",
          type: "Direct Operating Expense",
          rate: "~2%",
          balance: razorpayPgCharges,
          description: "Merchant processing & PG interchange fees on online transactions",
        },
      },
      journal_entries: journalEntries,
    });
  } catch (err) {
    return internalError(res, err, "financeLedger.getLedgerOverview");
  }
}

/**
 * GET /api/admin/finance/ledger/parties
 * Top Driver Debtors, Top Driver Creditors, and Customer Wallets
 */
async function getPartyBreakdown(req, res) {
  try {
    const scopedCityId =
      req.user.role === "superadmin"
        ? req.query.city_id
          ? Number(req.query.city_id)
          : null
        : parseInt(req.user.city_id, 10);

    const cityFilter = scopedCityId ? { city_id: scopedCityId } : {};

    const [debtorDrivers, creditorDrivers, topCustomerWallets] = await Promise.all([
      // Drivers with negative balance (Sundry Debtors)
      prisma.tbl_rider.findMany({
        where: {
          wallet_balance: { lt: 0 },
          ...cityFilter,
        },
        orderBy: { wallet_balance: "asc" },
        take: 20,
        select: {
          id: true,
          full_name: true,
          first_name: true,
          last_name: true,
          fmobile: true,
          vehicle_no: true,
          wallet_balance: true,
          city_id: true,
        },
      }),
      // Drivers with positive balance (Sundry Creditors)
      prisma.tbl_rider.findMany({
        where: {
          wallet_balance: { gt: 0 },
          ...cityFilter,
        },
        orderBy: { wallet_balance: "desc" },
        take: 20,
        select: {
          id: true,
          full_name: true,
          first_name: true,
          last_name: true,
          fmobile: true,
          vehicle_no: true,
          wallet_balance: true,
          city_id: true,
        },
      }),
      // Customers with wallet liability
      prisma.tbl_user.findMany({
        where: {
          wallet: { gt: 0 },
          ...cityFilter,
        },
        orderBy: { wallet: "desc" },
        take: 20,
        select: {
          id: true,
          name: true,
          mobile: true,
          wallet: true,
          email: true,
          city_id: true,
        },
      }),
    ]);

    const formatDriver = (d) => ({
      id: d.id,
      name: d.full_name || `${d.first_name || ""} ${d.last_name || ""}`.trim() || `Driver #${d.id}`,
      mobile: d.fmobile,
      vehicle_no: d.vehicle_no || "N/A",
      balance: round2(d.wallet_balance),
      city_id: d.city_id,
    });

    return res.status(200).json({
      success: true,
      debtor_drivers: debtorDrivers.map(formatDriver),
      creditor_drivers: creditorDrivers.map(formatDriver),
      customer_wallets: topCustomerWallets.map((c) => ({
        id: c.id,
        name: c.name || `User #${c.id}`,
        mobile: String(c.mobile || ""),
        email: c.email || "",
        balance: round2(c.wallet),
        city_id: c.city_id,
      })),
    });
  } catch (err) {
    return internalError(res, err, "financeLedger.getPartyBreakdown");
  }
}

/**
 * GET /api/admin/finance/ledger/export
 * Downloads standard CA / Audit-ready CSV
 */
async function exportLedgerCsv(req, res) {
  try {
    const { start, end, label } = parseDateRange(req.query);
    const scopedCityId =
      req.user.role === "superadmin"
        ? req.query.city_id
          ? Number(req.query.city_id)
          : null
        : parseInt(req.user.city_id, 10);

    const orders = await prisma.pkg_order.findMany({
      where: {
        odate: { gte: start, lte: end },
        ...(scopedCityId ? { city_id: scopedCityId } : {}),
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        odate: true,
        o_status: true,
        total_dcharge: true,
        d_charge: true,
        commission: true,
        driver_earning: true,
        cancel_charge: true,
        advance_payment: true,
        p_method_id: true,
        razorpay_payment_id: true,
        pick_name: true,
        drop_name: true,
        category: true,
        uid: true,
        rid: true,
      },
    });

    const uids = [...new Set(orders.map((o) => o.uid).filter(Boolean))];
    const rids = [...new Set(orders.map((o) => o.rid).filter(Boolean))];
    const [users, riders] = await Promise.all([
      prisma.tbl_user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, mobile: true } }),
      prisma.tbl_rider.findMany({ where: { id: { in: rids } }, select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true } }),
    ]);

    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name || `User #${u.id}`]));
    const riderMap = Object.fromEntries(
      riders.map((r) => [r.id, r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`])
    );

    const headers = [
      "Order ID",
      "Date",
      "Status",
      "Customer",
      "Driver",
      "Payment Mode",
      "Gross Fare / GMV (INR)",
      "Driver Share (INR)",
      "Platform Commission (INR)",
      "GST Output 18% (INR)",
      "TDS Sec 194-O 1% (INR)",
      "PG Fee 2% (INR)",
      "Net Platform Cut (INR)",
      "Advance Received (INR)",
      "Cancellation Fee (INR)",
    ];

    const rows = orders.map((o) => {
      const isCompleted = o.o_status === "Completed";
      const isCancelled = o.o_status === "Cancelled";
      const fare = Number(o.total_dcharge || o.d_charge || 0);
      const isCash = o.p_method_id === 1 || !o.p_method_id;
      const commPct = Number(o.commission || 0);
      const comm = isCompleted ? round2((fare * commPct) / 100) : 0;
      const gst = round2(comm * 0.18);
      const driverGross = isCompleted
        ? round2(Number(o.driver_earning) > 0 ? Number(o.driver_earning) : Math.max(0, fare - comm))
        : 0;
      const tds = round2(driverGross * 0.01);
      const pg = !isCash && isCompleted ? round2(fare * 0.02) : 0;
      const net = isCompleted ? round2(comm - pg) : (isCancelled ? Number(o.cancel_charge || 0) : 0);

      return [
        `"SO${String(o.id).padStart(6, "0")}"`,
        `"${o.odate ? new Date(o.odate).toISOString().slice(0, 19).replace("T", " ") : ""}"`,
        `"${o.o_status}"`,
        `"${(userMap[o.uid] || "").replace(/"/g, '""')}"`,
        `"${(riderMap[o.rid] || "").replace(/"/g, '""')}"`,
        `"${isCash ? "Cash" : "Online"}"`,
        fare.toFixed(2),
        driverGross.toFixed(2),
        comm.toFixed(2),
        gst.toFixed(2),
        tds.toFixed(2),
        pg.toFixed(2),
        net.toFixed(2),
        Number(o.advance_payment || 0).toFixed(2),
        Number(o.cancel_charge || 0).toFixed(2),
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="shifter_financial_ledger_${label.replace(/\s+/g, "_")}.csv"`
    );
    return res.status(200).send(csvContent);
  } catch (err) {
    return internalError(res, err, "financeLedger.exportLedgerCsv");
  }
}

module.exports = {
  getLedgerOverview,
  getPartyBreakdown,
  exportLedgerCsv,
};
