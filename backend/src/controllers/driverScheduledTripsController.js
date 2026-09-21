const prisma = require("../config/db");
const logger = require("../utils/logger");

// Driver-facing browse + interest-marking for booking_type=2 scheduled
// orders — see docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md
// §8. Follows this router's existing body-driven convention (riderController.js's
// packageListForDriver etc.) rather than path params/REST verbs.

async function listScheduledTrips(req, res) {
  try {
    const riderId = Number(req.body?.uid || 0);
    if (!riderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid is required" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { vehicle: true, city_id: true } });
    if (!rider) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Rider not found" });
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const orders = await prisma.pkg_order.findMany({
      where: {
        booking_type: 2,
        o_status: "Pending",
        rid: 0,
        category: rider.vehicle,
        ...(rider.city_id ? { city_id: rider.city_id } : {}),
      },
      orderBy: { schedule_date_time: "asc" },
    });

    const inWindow = orders.filter((o) => {
      const ms = o.schedule_date_time ? Date.parse(o.schedule_date_time) : NaN;
      return !Number.isNaN(ms) && ms >= now.getTime() && ms <= horizon.getTime();
    });

    const interestRows = inWindow.length
      ? await prisma.pkg_order_interest.findMany({
          where: { order_id: { in: inWindow.map((o) => o.id) }, rider_id: riderId },
        })
      : [];
    const interestedOrderIds = new Set(interestRows.map((r) => r.order_id));

    const tripData = inWindow.map((o) => ({
      id: String(o.id),
      category: o.category,
      pickup_address: o.paddress || "",
      delivery_address: o.daddress || "",
      schedule_date_time: o.schedule_date_time,
      estimated_fare: String(o.total_dcharge),
      is_interested: interestedOrderIds.has(o.id) ? "1" : "0",
    }));

    return res.status(200).json({ TripData: tripData, ResponseCode: "200", Result: "true", ResponseMsg: "Scheduled Trips Fetched Successfully" });
  } catch (err) {
    logger.error("listScheduledTrips failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function markInterest(req, res) {
  try {
    const riderId = Number(req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!riderId || !orderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid and order_id are required" });
    }

    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
    if (
      !order ||
      order.booking_type !== 2 ||
      order.o_status !== "Pending" ||
      order.rid !== 0
    ) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Order is not eligible for interest" });
    }

    try {
      await prisma.pkg_order_interest.create({ data: { order_id: orderId, rider_id: riderId } });
    } catch (err) {
      // P2002 = Prisma unique-constraint violation — the rider already
      // marked interest, which is not an error from the app's point of
      // view (idempotent tap of the same button).
      if (err.code !== "P2002") throw err;
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Marked as interested" });
  } catch (err) {
    logger.error("markInterest failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function removeInterest(req, res) {
  try {
    const riderId = Number(req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!riderId || !orderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid and order_id are required" });
    }

    await prisma.pkg_order_interest.deleteMany({ where: { order_id: orderId, rider_id: riderId } });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Interest removed" });
  } catch (err) {
    logger.error("removeInterest failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { listScheduledTrips, markInterest, removeInterest };
