const tripLifecycle = require("../services/tripLifecycle");
const logger = require("../utils/logger");

function registerOrderHandlers(io, socket) {
  socket.on("order:accept", async ({ rider_id, order_id }) => {
    try {
      const result = await tripLifecycle.acceptOrder(Number(order_id), Number(rider_id));

      socket.emit("order:accept:ack", {
        Result: result.success,
        msg: result.success ? "Accepted" : result.msg,
      });

      if (!result.success) return;

      const { order, rider } = result;
      io.to(`customer_${order.uid}`).emit("order:assigned", {
        order_id: order.id,
        rider_id: rider.id,
        rider_name: `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
        rider_phone: rider.fmobile,
        profile_picture: rider.profile_picture,
        vehicle_no: rider.vehicle_no,
        rider_lat: rider.rlats ? Number(rider.rlats) : null,
        rider_lng: rider.rlongs ? Number(rider.rlongs) : null,
        otp: order.otp,
        order_status: order.order_status,
        o_status: order.o_status,
      });
    } catch (err) {
      logger.error("order:accept handler failed:", err);
      socket.emit("order:accept:ack", { Result: false, msg: "Internal server error" });
    }
  });

  socket.on("order:reject", async ({ rider_id, order_id }) => {
    try {
      await tripLifecycle.rejectOrder(Number(order_id), Number(rider_id));
    } catch (err) {
      logger.error("order:reject handler failed:", err);
    }
  });

  socket.on("order:status_update", async ({ rider_id, order_id, status }) => {
    try {
      const result = await tripLifecycle.updateStatus(Number(order_id), Number(rider_id), status);

      socket.emit("order:status_update:ack", {
        Result: result.success,
        msg: result.msg,
      });

      if (!result.success) return;

      const room = `order_${order_id}`;
      if (status === "complete") {
        io.to(room).emit("order:completed", {
          order_id: Number(order_id),
          order_status: result.order_status,
          o_status: result.o_status,
        });
      } else {
        io.to(room).emit("order:status_changed", {
          order_id: Number(order_id),
          order_status: result.order_status,
          o_status: result.o_status,
        });
      }
    } catch (err) {
      logger.error("order:status_update handler failed:", err);
      socket.emit("order:status_update:ack", { Result: false, msg: "Internal server error" });
    }
  });
}

module.exports = { registerOrderHandlers };
