process.env.INVOICE_SECRET_KEY = "test-secret";

jest.mock("../../config/db", () => ({
  pkg_order: { findFirst: jest.fn(), aggregate: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_payment_list: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const crypto = require("crypto");
const prisma = require("../../config/db");
const ctrl = require("../orderInvoiceController");

const sign = (orderId, uid, exp) =>
  crypto.createHash("sha256").update(`${orderId}|${uid}|${exp}|test-secret`).digest("hex");

function mockRes() {
  const res = { headers: {} };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.set = jest.fn((h) => { Object.assign(res.headers, h); return res; });
  res.send = jest.fn((b) => { res.body = b; return res; });
  return res;
}

const order = {
  id: 42, uid: 7, rid: 9, o_status: "Completed", odate: new Date("2026-10-01T10:00:00Z"),
  paddress: "Pickup Street, Delhi", daddress: "Drop Road, Noida",
  d_charge: 200, service_charge: 20, total_dcharge: 230, extra_mile_charge: 0, cou_amt: 10,
  referral_points_used: 50, referral_points_amount: 5, p_method_id: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findFirst.mockResolvedValue(order);
  prisma.pkg_order.aggregate.mockResolvedValue({ _avg: { cust_rate: 4.5 } });
  prisma.tbl_rider.findUnique.mockResolvedValue({ first_name: "Ravi", last_name: "K", vehicle_no: "DL1AB1234" });
  prisma.tbl_payment_list.findUnique.mockResolvedValue({ title: "Wallet" });
});

describe("invoice PDF download", () => {
  const exp = Date.now() + 60_000;
  const goodQuery = () => ({ order_id: "42", uid: "7", exp: String(exp), token: sign(42, 7, exp) });

  test("valid signed link returns an attachment PDF", async () => {
    const res = mockRes();
    await ctrl.downloadInvoicePdf({ query: goodQuery() }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.headers["Content-Disposition"]).toContain("attachment");
    expect(res.headers["Content-Disposition"]).toContain("SO0000000042");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
    expect(prisma.pkg_order.findFirst).toHaveBeenCalledWith({ where: { uid: 7, id: 42 } });
  });

  test("tampered uid (another user's invoice) is rejected without touching the DB", async () => {
    const res = mockRes();
    await ctrl.downloadInvoicePdf({ query: { ...goodQuery(), uid: "8" } }, res);
    expect(res.statusCode).toBe(400);
    expect(prisma.pkg_order.findFirst).not.toHaveBeenCalled();
  });

  test("tampered order_id is rejected", async () => {
    const res = mockRes();
    await ctrl.downloadInvoicePdf({ query: { ...goodQuery(), order_id: "43" } }, res);
    expect(res.statusCode).toBe(400);
  });

  test("expired link is rejected", async () => {
    const past = Date.now() - 1000;
    const res = mockRes();
    await ctrl.downloadInvoicePdf({ query: { order_id: "42", uid: "7", exp: String(past), token: sign(42, 7, past) } }, res);
    expect(res.statusCode).toBe(400);
  });

  test("missing token is rejected", async () => {
    const res = mockRes();
    await ctrl.downloadInvoicePdf({ query: { order_id: "42", uid: "7", exp: String(exp) } }, res);
    expect(res.statusCode).toBe(400);
  });

  test("order not owned/found returns 404", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.downloadInvoicePdf({ query: goodQuery() }, res);
    expect(res.statusCode).toBe(404);
  });

  test("DB failure returns a clean 500 message", async () => {
    prisma.pkg_order.findFirst.mockRejectedValue(new Error("db down"));
    const res = mockRes();
    await ctrl.downloadInvoicePdf({ query: goodQuery() }, res);
    expect(res.statusCode).toBe(500);
    expect(String(res.body)).toMatch(/Could not generate/);
  });

  test("HTML page shows the Download PDF button pointing at the signed PDF link", async () => {
    const res = mockRes();
    await ctrl.renderInvoice({ query: goodQuery() }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Download PDF");
    expect(res.body).toContain("invoice.pdf?order_id=42&amp;uid=7");
  });

  test("invoice data: payable = fare - coins - coupon", async () => {
    const d = await ctrl.loadInvoiceData(7, 42);
    expect(d.total).toBe("215.00");
    expect(d.bookingId).toBe("SO0000000042");
  });
});
