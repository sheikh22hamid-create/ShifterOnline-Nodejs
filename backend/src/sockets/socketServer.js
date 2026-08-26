const { Server } = require("socket.io");
const dispatchManager = require("../services/dispatchManager");
const { registerOrderHandlers } = require("./orderSocket");
const { registerTrackingHandlers } = require("./trackingSocket");
const logger = require("../utils/logger");

let ioInstance = null;

function initSocket(httpServer) {
  ioInstance = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  dispatchManager.init(ioInstance);

  ioInstance.on("connection", (socket) => {
    logger.info(`socket connected: ${socket.id}`);

    socket.on("driver:join", ({ rider_id }) => {
      socket.data.riderId = Number(rider_id);
      socket.join(`driver_${rider_id}`);
    });

    socket.on("customer:join", ({ user_id, order_id }) => {
      socket.data.userId = Number(user_id);
      socket.join(`customer_${user_id}`);
      if (order_id) {
        socket.join(`order_${order_id}`);
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
