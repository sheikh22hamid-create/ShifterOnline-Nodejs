const prisma = require("../config/db");
const logger = require("../utils/logger");
const { RIDER_LOCATION_WRITE_THROTTLE_MS } = require("../config/constants");

/** rider_id -> last DB write timestamp, to throttle location persistence. */
const lastDbWriteAt = new Map();

function registerTrackingHandlers(io, socket) {
  socket.on("driver:location_ping", ({ rider_id, order_id, lat, lng, heading }) => {
    io.to(`order_${order_id}`).emit("driver:location_stream", {
      order_id: Number(order_id),
      lat,
      lng,
      heading,
    });

    const riderId = Number(rider_id);
    const now = Date.now();
    const lastWrite = lastDbWriteAt.get(riderId) || 0;
    if (now - lastWrite < RIDER_LOCATION_WRITE_THROTTLE_MS) return;

    lastDbWriteAt.set(riderId, now);
    prisma.tbl_rider
      .update({ where: { id: riderId }, data: { rlats: String(lat), rlongs: String(lng) } })
      .catch((err) => logger.error(`driver:location_ping: failed persisting location for rider ${riderId}:`, err));
  });
}

module.exports = { registerTrackingHandlers };
