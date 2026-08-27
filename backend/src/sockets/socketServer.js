const { Server } = require("socket.io");
const prisma = require("../config/db");
const dispatchManager = require("../services/dispatchManager");
const adminSocket = require("./adminSocket");
const { registerOrderHandlers } = require("./orderSocket");
const { registerTrackingHandlers } = require("./trackingSocket");
const logger = require("../utils/logger");

/**
 * order_<id> is the shared tracking room, but neither driver:join nor
 * customer:join's own payload carries an order_id on every call (the spec's
 * driver:join shape never does). Without this, a socket that reconnects
 * mid-trip — a dropped connection, a backgrounded app — silently stops
 * receiving order:status_changed/completed/driver:location_stream until
 * something else happens to rejoin it.
 */
async function rejoinActiveOrderRoomForRider(socket, riderId) {
  try {
    const activeOrder = await prisma.pkg_order.findFirst({
      where: { rid: riderId, order_status: { in: [1, 2, 3] } },
      select: { id: true },
    });
    if (activeOrder) socket.join(`order_${activeOrder.id}`);
  } catch (err) {
    logger.error(`rejoinActiveOrderRoomForRider failed for rider ${riderId}:`, err);
  }
}

async function rejoinActiveOrderRoomForCustomer(socket, userId) {
  try {
    const activeOrder = await prisma.pkg_order.findFirst({
      where: { uid: userId, order_status: { in: [0, 1, 2, 3] } },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (activeOrder) socket.join(`order_${activeOrder.id}`);
  } catch (err) {
    logger.error(`rejoinActiveOrderRoomForCustomer failed for user ${userId}:`, err);
  }
}

let ioInstance = null;

function initSocket(httpServer) {
  ioInstance = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  dispatchManager.init(ioInstance);
  adminSocket.init(ioInstance);

  ioInstance.on("connection", (socket) => {
    logger.info(`socket connected: ${socket.id}`);

    socket.on("driver:join", async ({ rider_id }) => {
      socket.data.riderId = Number(rider_id);
      socket.join(`driver_${rider_id}`);
      rejoinActiveOrderRoomForRider(socket, socket.data.riderId);

      // Cached once at join time so driver:location_ping (high-frequency)
      // doesn't need a DB lookup per ping to route admin:live_driver_ping.
      try {
        const rider = await prisma.tbl_rider.findUnique({ where: { id: socket.data.riderId }, select: { city_id: true } });
        socket.data.riderCityId = rider ? rider.city_id : null;
      } catch (err) {
        logger.error(`driver:join: failed loading city_id for rider ${rider_id}:`, err);
      }
    });

    adminSocket.registerAdminHandlers(ioInstance, socket);

    socket.on("customer:join", ({ user_id, order_id }) => {
      socket.data.userId = Number(user_id);
      socket.join(`customer_${user_id}`);
      if (order_id) {
        socket.join(`order_${order_id}`);
      } else {
        rejoinActiveOrderRoomForCustomer(socket, socket.data.userId);
      }
    });

    registerOrderHandlers(ioInstance, socket);
    registerTrackingHandlers(ioInstance, socket);

    socket.on("disconnect", (reason) => {
      logger.info(`socket disconnected: ${socket.id} (${reason})`);
    });
  });

  return ioInstance;
}

function getIO() {
  if (!ioInstance) {
    throw new Error("Socket.io not initialized — call initSocket(httpServer) first");
  }
  return ioInstance;
}

module.exports = { initSocket, getIO };
