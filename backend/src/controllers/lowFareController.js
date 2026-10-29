const logger = require("../utils/logger");
const service = require("../services/lowFareService");

// Driver HTTP layer for Low Fare Booking (spec 2026-10-27), legacy { Result, msg } shape at HTTP 200 like the Customise
// driver calls. The low_fare_booking_enabled switch stops NEW bookings (createOrderCore); it deliberately does not block
// these calls, so orders that were already booked can still be listed and accepted after an admin turns the switch off.
// All rules live in lowFareService.
async function guarded(req, res, run) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    if (!riderId) return res.status(200).json({ Result: false, msg: "rider_id is required" });
    return await run(riderId, req.body || {});
  } catch (err) {
    logger.error("lowFareController failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

const list = (req, res) => guarded(req, res, async (rid) => {
  const orders = await service.listForDriver(rid);
  return res.status(200).json({ Result: true, orders, count: orders.filter((o) => o.unread && o.state !== "taken").length });
});
const count = (req, res) => guarded(req, res, async (rid) => res.status(200).json({ Result: true, count: await service.countForDriver(rid) }));
const seen = (req, res) => guarded(req, res, async (rid, b) => {
  await service.markSeen(rid, b.order_ids);
  return res.status(200).json({ Result: true });
});
const accept = (req, res) => guarded(req, res, async (rid, b) => {
  const out = await service.accept(Number(b.order_id), rid);
  return res.status(200).json(out.ok ? { Result: true, order_id: out.order_id } : { Result: false, msg: out.msg });
});

module.exports = { list, count, seen, accept };
