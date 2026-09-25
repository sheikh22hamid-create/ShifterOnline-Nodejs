jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  pkg_order: { findMany: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  tbl_payment_list: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));

const prisma = require("../../config/db");
const { getLedgerOverview, getPartyBreakdown, exportLedgerCsv } = require("../financeLedgerController");

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return res;
}

describe("financeLedgerController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getLedgerOverview", () => {
    it("computes complete double-entry accounts with GST and TDS 194-O", async () => {
      // Mock order raw aggregate
      prisma.$queryRaw
        // 1. Completed orders
        .mockResolvedValueOnce([
          {
            completed_count: 10,
            total_gmv: 5000,
            sum_d_charge: 5000,
            sum_driver_earning: 4000,
            sum_commission_revenue: 1000,
            cash_gmv: 2000,
            online_gmv: 3000,
            commission_from_cash: 400,
            commission_from_online: 600,
            advance_in_completed: 500,
          },
        ])
        // 2. Active advance
        .mockResolvedValueOnce([{ active_count: 2, active_advance_liability: 350 }])
        // 3. Cancelled orders
        .mockResolvedValueOnce([{ cancelled_count: 1, cancellation_income: 50, distance_refunds_owed: 25 }])
        // 4. Customer wallet balance
        .mockResolvedValueOnce([{ positive_wallet_users: 5, total_customer_wallet_liability: 1200 }])
        // 5. Driver wallet balance
        .mockResolvedValueOnce([
          {
            creditors_count: 8,
            sundry_creditors_payable: 3200,
            debtors_count: 3,
            sundry_debtors_receivable: 850,
          },
        ])
        // 6. Driver withdraw requests
        .mockResolvedValueOnce([
          {
            pending_settlement_payouts: 600,
            pending_payout_count: 2,
            approved_settled_payouts: 1500,
            approved_payout_count: 4,
          },
        ]);

      prisma.pkg_order.findMany.mockResolvedValue([
        {
          id: 101,
          odate: new Date("2026-03-01T10:00:00Z"),
          o_status: "Completed",
          order_status: 3,
          total_dcharge: 500,
          d_charge: 500,
          commission: 20,
          driver_earning: 400,
          cancel_charge: 0,
          advance_payment: "50",
          p_method_id: 2,
          category: "Tata Ace",
          uid: 10,
          rid: 20,
        },
      ]);

      prisma.tbl_user.findMany.mockResolvedValue([{ id: 10, name: "Aman", mobile: 9876543210 }]);
      prisma.tbl_rider.findMany.mockResolvedValue([{ id: 20, full_name: "Rajesh", fmobile: "9123456780" }]);
      prisma.tbl_payment_list.findMany.mockResolvedValue([{ id: 2, title: "Razorpay" }]);

      const req = {
        query: { period: "this_month" },
        user: { role: "superadmin" },
      };
      const res = mockRes();

      await getLedgerOverview(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = res.json.mock.calls[0][0];
      expect(json.success).toBe(true);

      // Verify Customer-side
      expect(json.customer_accounts.advance_deposit_received.balance).toBe(350);
      expect(json.customer_accounts.customer_wallet_balance.balance).toBe(1200);
      expect(json.customer_accounts.refunds_payable.balance).toBe(25);

      // Verify Driver-side
      expect(json.driver_accounts.driver_earnings_payable.balance).toBe(4000);
      expect(json.driver_accounts.platform_commission_receivable.balance).toBe(400);
      expect(json.driver_accounts.tds_194o_deducted.balance).toBe(40); // 1% of 4000
      expect(json.driver_accounts.sundry_debtors.balance).toBe(850);
      expect(json.driver_accounts.sundry_creditors.balance).toBe(3200);

      // Verify Company-side
      expect(json.company_accounts.platform_commission_income.balance).toBe(1000);
      expect(json.company_accounts.gst_output_commission.balance).toBe(180); // 18% of 1000
      expect(json.company_accounts.razorpay_gateway_charges.balance).toBe(60); // 2% of 3000
      expect(json.company_accounts.cancellation_charges_income.balance).toBe(50);

      // Verify Net Profit
      // Gross Revenue: 1000 (Comm) + 50 (Cancel) = 1050
      // Direct Expenses: 60 (PG fee)
      // Net Profit = 1050 - 60 = 990
      expect(json.summary.net_operating_profit).toBe(990);
    });
  });

  describe("getPartyBreakdown", () => {
    it("returns debtors, creditors, and customer wallets", async () => {
      prisma.tbl_rider.findMany
        .mockResolvedValueOnce([{ id: 1, full_name: "Debtor Driver", wallet_balance: -250, fmobile: "999" }])
        .mockResolvedValueOnce([{ id: 2, full_name: "Creditor Driver", wallet_balance: 500, fmobile: "888" }]);

      prisma.tbl_user.findMany.mockResolvedValueOnce([
        { id: 3, name: "Wallet User", wallet: 100, mobile: 777, email: "user@test.com" },
      ]);

      const req = { query: {}, user: { role: "superadmin" } };
      const res = mockRes();

      await getPartyBreakdown(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = res.json.mock.calls[0][0];
      expect(json.success).toBe(true);
      expect(json.debtor_drivers.length).toBe(1);
      expect(json.debtor_drivers[0].name).toBe("Debtor Driver");
      expect(json.creditor_drivers.length).toBe(1);
      expect(json.customer_wallets.length).toBe(1);
    });
  });

  describe("exportLedgerCsv", () => {
    it("streams CSV with proper headers and status 200", async () => {
      prisma.pkg_order.findMany.mockResolvedValue([
        {
          id: 5,
          odate: new Date("2026-03-01T12:00:00Z"),
          o_status: "Completed",
          total_dcharge: 1000,
          d_charge: 1000,
          commission: 15,
          driver_earning: 850,
          cancel_charge: 0,
          advance_payment: "100",
          p_method_id: 1,
          uid: 10,
          rid: 20,
        },
      ]);
      prisma.tbl_user.findMany.mockResolvedValue([{ id: 10, name: "Customer X" }]);
      prisma.tbl_rider.findMany.mockResolvedValue([{ id: 20, full_name: "Driver Y" }]);

      const req = { query: { period: "this_month" }, user: { role: "superadmin" } };
      const res = mockRes();

      await exportLedgerCsv(req, res);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Order ID,Date,Status"));
    });
  });
});
