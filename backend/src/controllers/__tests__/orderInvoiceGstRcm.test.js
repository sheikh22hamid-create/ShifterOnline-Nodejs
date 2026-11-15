process.env.INVOICE_SECRET_KEY = "test-secret";

jest.mock("../../config/db", () => ({
  pkg_order: { findFirst: jest.fn(), aggregate: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_payment_list: { findUnique: jest.fn() },
  $queryRaw: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const crypto = require("crypto");
const prisma = require("../../config/db");
const ctrl = require("../orderInvoiceController");

const sign = (orderId, uid, exp) => crypto.createHash("sha256").update(`${orderId}|${uid}|${exp}|test-secret`).digest("hex");
function mockRes() {
  const res = { headers: {} };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.set = jest.fn((h) => { Object.assign(res.headers, h); return res; });
  res.send = jest.fn((b) => { res.body = b; return res; });
  return res;
}
const exp = Date.now() + 60_000;
const query = (orderId = 42, uid = 7) => ({ order_id: String(orderId), uid: String(uid), exp: String(exp), token: sign(orderId, uid, exp) });

const order = (o = {}) => ({
  id: 42, uid: 7, rid: 9, o_status: "Completed", odate: new Date("2026-10-01T10:00:00Z"),
  paddress: "Pickup Street, Delhi", daddress: "Drop Road, Noida",
  d_charge: 1000, service_charge: 0, total_dcharge: 1000, extra_mile_charge: 0, cou_amt: 0,
  referral_points_used: 0, referral_points_amount: 0, p_method_id: 3, ...o,
});
const GST_ROW = { gstin: "27AAPFU0939F1ZV", legal_name: "ABC TRADERS PRIVATE LIMITED", trade_name: "ABC Traders", address: "12, MG Road, Mumbai", state: "Maharashtra", state_code: "27", pincode: "400053", verified_at: new Date() };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findFirst.mockResolvedValue(order());
  prisma.pkg_order.aggregate.mockResolvedValue({ _avg: { cust_rate: 4.5 } });
  prisma.tbl_rider.findUnique.mockResolvedValue({ first_name: "Ravi", last_name: "K", vehicle_no: "DL1AB1234" });
  prisma.tbl_payment_list.findUnique.mockResolvedValue({ title: "Wallet" });
  prisma.$queryRaw.mockResolvedValue([]); // no GST details by default
});

const html = async () => { const r = mockRes(); await ctrl.renderInvoice({ query: query() }, r); return r.body; };
const pdfText = async () => { // PDFKit writes text as plain Helvetica strings in an uncompressed-enough stream only when asked; use loadInvoiceData instead
  return ctrl.loadInvoiceData(7, 42);
};

describe("GST details on the invoice", () => {
  it("shown when the booking has verified GST details", async () => {
    prisma.$queryRaw.mockResolvedValue([GST_ROW]);
    const page = await html();
    expect(page).toContain("GST details");
    expect(page).toContain("27AAPFU0939F1ZV");
    expect(page).toContain("ABC TRADERS PRIVATE LIMITED");
    expect(page).toContain("Maharashtra (27)");
    expect(page).toContain("12, MG Road, Mumbai");
  });

  it("no GSTIN given -> no GST section at all (nothing empty or misleading)", async () => {
    const page = await html();
    expect(page).not.toContain("GST details");
    expect(page).not.toContain("GSTIN");
  });

  it("the GST text is HTML-escaped", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...GST_ROW, legal_name: "A <b>&</b> Co" }]);
    const page = await html();
    expect(page).toContain("A &lt;b&gt;&amp;&lt;/b&gt; Co");
    expect(page).not.toContain("A <b>&</b> Co");
  });

  it("the rest of the invoice is unchanged (fare breakdown, total paid, download button)", async () => {
    const page = await html();
    for (const part of ["Fare breakdown", "Total paid", "Paid via Wallet", "Download PDF", "SO0000000042"]) expect(page).toContain(part);
  });
});

describe("RCM summary (display only)", () => {
  it("completed ride, final total fare Rs 1,000 -> RCM 5% = Rs 50, with fare, rate and amount", async () => {
    const page = await html();
    expect(page).toContain("RCM summary");
    expect(page).toContain("Final total fare");
    expect(page).toContain("₹1000.00");
    expect(page).toContain("5%");
    expect(page).toContain("₹50.00");
    expect(page).toContain("not charged to you");
  });

  it("it never changes what is payable: the total paid stays the fare", async () => {
    const data = await pdfText();
    expect(data.total).toBe("1000.00");
    expect(data.rcm).toEqual({ finalTotalFare: 1000, ratePercent: 5, amount: 50 });
    expect(Number(data.total)).toBe(data.fareTotal); // RCM is not added
    expect(data.charges.some(([label]) => /rcm/i.test(label))).toBe(false);
  });

  it("not shown before the ride is complete or when it is cancelled", async () => {
    for (const status of ["Processing", "Pickup", "On Route", "Cancelled"]) {
      prisma.pkg_order.findFirst.mockResolvedValue(order({ o_status: status }));
      expect(await html()).not.toContain("RCM summary");
    }
  });

  it("is computed from the final total fare (waiting charge included), not the coins-reduced amount", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(order({ d_charge: 900, total_dcharge: 1000, referral_points_used: 100, referral_points_amount: 100 }));
    const data = await pdfText();
    expect(data.rcm.finalTotalFare).toBe(1000);
    expect(data.rcm.amount).toBe(50);
    expect(data.total).toBe("900.00"); // the payable still reflects the coins, untouched by RCM
  });

  it("nothing about RCM is written anywhere: no database write happens while rendering", async () => {
    await html();
    const writes = prisma.$queryRaw.mock.calls.filter((c) => /INSERT|UPDATE|DELETE/i.test(String(c[0])));
    expect(writes).toHaveLength(0);
  });
});

describe("PDF", () => {
  it("still downloads with GST + RCM present", async () => {
    prisma.$queryRaw.mockResolvedValue([GST_ROW]);
    const r = mockRes();
    await ctrl.downloadInvoicePdf({ query: query() }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("is still a single page with a long GST address and RCM", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...GST_ROW, address: "Plot 12, A very long industrial estate address line that keeps going, Sector 9, Phase 2, Mumbai, Maharashtra, 400053" }]);
    const r = mockRes();
    await ctrl.downloadInvoicePdf({ query: query() }, r);
    const pages = (r.body.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length;
    expect(pages).toBe(1);
  });
});
