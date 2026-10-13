const prisma = require("../config/db");
const senderPayToken = require("./senderPayToken");

// settlementService is required lazily: whatsapp/notifications loads this module for buildLink, and
// pulling the whole settlement stack in at load time would couple every notification import to it.
const settlementService = () => require("./settlementService");
const STATUS = { PENDING: "pending", CASH_RECEIVED: "cash_received", PAID_ONLINE: "paid_online", CUSTOMER_OWES: "customer_owes" };
const fail = (code, message) => { const { SettlementError } = settlementService(); return new SettlementError(code, message); };

const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || null;
const shorten = (s) => (s ? String(s).slice(0, 80) : null);
const ONLINE_PAYABLE = [STATUS.PENDING, STATUS.CUSTOMER_OWES];

// Public browser link the sender can pay from, or null when PUBLIC_BASE_URL / the signing secret is missing.
function buildLink(orderId) {
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const token = base ? senderPayToken.mint(orderId) : null;
  return token ? `${base}/pay/s/${token}` : null;
}

function parse(token) {
  const t = senderPayToken.verify(token);
  if (!t) throw fail("INVALID_LINK", "This payment link is not valid.");
  return t;
}

async function getPublicState(token) {
  const { orderId, expiresAt } = parse(token);
  if (expiresAt < Date.now()) return { state: "expired" };
  const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!s) return { state: "closed" };
  if (s.status === STATUS.PAID_ONLINE || s.status === STATUS.CASH_RECEIVED) return { state: "paid" };
  if (s.payer === "receiver") return s.status === STATUS.PENDING ? { state: "receiver_pending" } : { state: "closed" };
  if (!ONLINE_PAYABLE.includes(s.status)) return { state: "closed" };
  const [order, rider] = await Promise.all([
    prisma.pkg_order.findUnique({ where: { id: orderId }, select: { paddress: true, daddress: true } }),
    prisma.tbl_rider.findUnique({ where: { id: s.rid }, select: { first_name: true } }),
  ]);
  return {
    state: "payable",
    order_id: orderId,
    amount_due: Number(s.amount_due),
    markup: 0,
    total: Number(s.amount_due),
    driver_first_name: firstName(rider && rider.first_name),
    pickup: shorten(order && order.paddress),
    drop: shorten(order && order.daddress),
  };
}

// Reuses the customer online-payment flow; the settlement's own customer is the payer of record.
async function ownerOf(orderId) {
  const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!s) throw fail("INVALID_STATE", "No payment is due for this order.");
  return s.uid;
}

async function createOrderByToken(token) {
  const { orderId, expiresAt } = parse(token);
  if (expiresAt < Date.now()) throw fail("LINK_EXPIRED", "This payment link has expired.");
  return settlementService().createOnlineOrder({ orderId, uid: await ownerOf(orderId) });
}

// Not expiry-gated: a payment already captured on the page must still be recorded. settleOnline binds it
// to the Razorpay order stored on the settlement and verifies the signature and amount.
async function settleByToken({ token, paymentId, razorpayOrderId, signature }) {
  const { orderId } = parse(token);
  return settlementService().settleOnline({ orderId, uid: await ownerOf(orderId), paymentId, razorpayOrderId, signature });
}

module.exports = { buildLink, getPublicState, createOrderByToken, settleByToken };
