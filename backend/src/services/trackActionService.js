// backend/src/services/trackActionService.js
// The two things a receiver can DO from the tracking page after delivery. Both authorize through the
// tracking link: the order must be the link's order, still the link's drop contact, Completed, and
// inside the 24 h delivered window.
const prisma = require("../config/db");
const snapshot = require("./trackSnapshotService");
const receiverPayService = require("./receiverPayService");

class TrackActionError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "TrackActionError";
    this.code = code;
    this.status = status;
  }
}

const ALLOWED_TAGS = new Set([
  "Polite & Helpful", "On-Time Arrival", "Careful with items", "Safe Driving", "Clean Vehicle",
  "Delayed Arrival", "Demanded Extra Cash", "Careless Handling", "Rash Driving", "Rude Behaviour",
]);
const COMMENT_MAX = 500;

async function requireDelivered(link, now) {
  const loaded = await snapshot.loadLinkedOrder(link);
  const order = loaded.order;
  if (!order || !snapshot.isCompleted(order) || !snapshot.deliveredWindowOpen(order, now)) {
    throw new TrackActionError("NOT_AVAILABLE", "This link is no longer available.", 404);
  }
  return order;
}

async function mintPayLink(link, { now = Date.now() } = {}) {
  const order = await requireDelivered(link, now);
  try {
    return await receiverPayService.mintLink({ orderId: order.id });
  } catch (err) {
    if (err instanceof receiverPayService.ReceiverPayError) {
      throw new TrackActionError(err.code, err.message, err.code === "NOT_CONFIGURED" ? 503 : 409);
    }
    throw err;
  }
}

function parseRating(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? { ok: true, value: n } : { ok: false };
}

async function submitReview(link, body, { now = Date.now() } = {}) {
  const order = await requireDelivered(link, now);
  const b = body || {};
  const driver = parseRating(b.driver_rating);
  const delivery = parseRating(b.delivery_rating);
  if (!driver.ok || !delivery.ok || (driver.value === null && delivery.value === null)) {
    throw new TrackActionError("VALIDATION", "Please give a rating between 1 and 5.", 400);
  }
  const rawTags = b.tags === undefined || b.tags === null ? [] : b.tags;
  if (!Array.isArray(rawTags) || rawTags.some((t) => typeof t !== "string" || !ALLOWED_TAGS.has(t))) {
    throw new TrackActionError("VALIDATION", "Unknown feedback tag.", 400);
  }
  const tags = [...new Set(rawTags)];
  const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, COMMENT_MAX) : "";

  const existing = await prisma.order_receiver_feedback.findUnique({ where: { order_id: order.id }, select: { id: true } });
  if (existing) throw new TrackActionError("ALREADY_SUBMITTED", "You have already sent your feedback.", 409);
  try {
    await prisma.order_receiver_feedback.create({
      data: {
        order_id: order.id,
        rider_id: Number(order.rid) || 0,
        receiver_phone: link.receiver_phone,
        driver_rating: driver.value,
        delivery_rating: delivery.value,
        feedback_tags: tags.length ? tags.join(", ").slice(0, 255) : null,
        comment: comment || null,
        created_at: new Date(),
      },
    });
  } catch (err) {
    if (err && err.code === "P2002") throw new TrackActionError("ALREADY_SUBMITTED", "You have already sent your feedback.", 409);
    throw err;
  }
  return { ok: true };
}

module.exports = { TrackActionError, ALLOWED_TAGS, mintPayLink, submitReview };
