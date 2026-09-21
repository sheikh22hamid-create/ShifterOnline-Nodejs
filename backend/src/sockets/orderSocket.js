const tripLifecycle = require("../services/tripLifecycle");
const logger = require("../utils/logger");
const { getAdvancePaymentTimerInfo } = require("../utils/advancePaymentTimer");

function registerOrderHandlers(io, socket) {
  socket.on("order:accept", async ({ rider_id, order_id }) => {
    let claim;
    try {
      // Ack off the fast atomic claim alone — see
      // tripLifecycle.claimOrderForRider's comment. Pricing, advance_payment,
      // and notifications (finalizeAcceptedOrder, below) run in the
      // background afterward: none of them decide whether this accept won,
      // and awaiting them here was costing the driver's own accept ack ~8s
      // (measured live) before their "waiting for advance payment" screen
      // could even open.
      claim = await tripLifecycle.claimOrderForRider(Number(order_id), Number(rider_id));
    } catch (err) {
      logger.error("order:accept handler failed:", err);
      socket.emit("order:accept:ack", { Result: false, msg: "Internal server error" });
      return;
    }

    if (!claim.success) {
      socket.emit("order:accept:ack", {
        Result: false,
        msg: claim.msg,
      });
      return;
    }

    // order_<id> is the shared tracking room between customer and the
    // now-assigned driver (spec §6.1) — the driver only joins it here,
    // once they've actually won the order.
    socket.join(`order_${order_id}`);

    try {
      const { order, rider } = await tripLifecycle.finalizeAcceptedOrder(
        Number(order_id),
        Number(rider_id),
        claim.acceptedPackageId
      );

      // Same computation the driver's pkgHistory poll and the customer's
      // own mapinfo re-fetch both use (getAdvancePaymentTimerInfo) — this
      // event fires right after accept_time is written, so remaining_seconds
      // is effectively the full timeout, but deriving it here instead of a
      // hardcoded 120 keeps this one value from ever drifting out of sync
      // with what every later re-fetch on either app computes.
      const timerInfo = getAdvancePaymentTimerInfo(order);
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
        // Let the customer open advance payment from this event immediately,
        // without waiting for a second REST request to finish.
        Order_Status: order.o_status,
        Order_flow_id: order.order_status,
        total_Delivery_charge: String(order.total_dcharge),
        advance_payment: order.advance_payment,
        // See orderController.js's getOrderDetails for why this must not be
        // re-derived from the advance amount — order.payment_status is
        // already the correct, gateway/no-advance-plan-verified value.
        payment_status: order.payment_status ?? 0,
        advance_payment_timer: timerInfo.remaining_seconds,
        advance_payment_msg: timerInfo.is_advance_payment_required
          ? "Please complete the advance payment to confirm your order. Kindly note that if the payment is not completed within 2 minutes, your order will be automatically cancelled."
          : "",
      });
    } catch (err) {
      logger.error(`finalizeAcceptedOrder failed for order ${order_id}:`, err);
    }

    socket.emit("order:accept:ack", {
      Result: true,
      msg: "Accepted",
    });
  });

  socket.on("order:reject", async ({ rider_id, order_id, package_id }) => {
    try {
      await tripLifecycle.rejectOrder(Number(order_id), Number(rider_id), package_id != null ? Number(package_id) : null);
    } catch (err) {
      logger.error("order:reject handler failed:", err);
    }
  });

  socket.on("order:driver_cancel", async ({ rider_id, order_id, reason }) => {
    try {
      const result = await tripLifecycle.driverCancel(Number(order_id), Number(rider_id), reason);
      socket.emit("order:driver_cancel:ack", {
        Result: result.success,
        msg: result.success ? "Ride cancelled and advance refunded" : result.msg,
        refund_amount: result.refund_amount,
        refund_status: result.refund_status,
      });
    } catch (err) {
      logger.error("order:driver_cancel handler failed:", err);
      socket.emit("order:driver_cancel:ack", { Result: false, msg: "Could not cancel ride" });
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
