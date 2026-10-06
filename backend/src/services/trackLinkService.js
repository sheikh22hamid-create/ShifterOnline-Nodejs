const crypto = require("crypto");
const prisma = require("../config/db");
const { normalizeToLast10Digits } = require("../utils/phone");

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const newToken = () => crypto.randomBytes(32).toString("base64url");
const isTokenShape = (token) => TOKEN_SHAPE.test(String(token || ""));

// One link per order, valid for the order's current drop contact. A different phone rotates the
// token on the same row, so the previous number's link stops working.
async function getOrCreate(orderId, rawPhone) {
  const phone = normalizeToLast10Digits(rawPhone);
  if (phone.length !== 10) return null;
  const existing = await prisma.order_track_link.findUnique({ where: { order_id: orderId } });
  if (existing && existing.receiver_phone === phone) return existing;
  if (existing) {
    return prisma.order_track_link.update({ where: { id: existing.id }, data: { token: newToken(), receiver_phone: phone } });
  }
  try {
    return await prisma.order_track_link.create({
      data: { order_id: orderId, token: newToken(), receiver_phone: phone, created_at: new Date() },
    });
  } catch (err) {
    if (err && err.code === "P2002") return prisma.order_track_link.findUnique({ where: { order_id: orderId } });
    throw err;
  }
}

async function findByToken(token) {
  if (!isTokenShape(token)) return null;
  return prisma.order_track_link.findUnique({ where: { token } });
}

function buildLink(token) {
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return base ? `${base}/track/${token}` : null;
}

async function touchViewed(id) {
  try {
    await prisma.order_track_link.update({ where: { id }, data: { last_viewed_at: new Date() } });
  } catch (_) {
    // a view counter must never fail a request
  }
}

module.exports = { isTokenShape, getOrCreate, findByToken, buildLink, touchViewed };
