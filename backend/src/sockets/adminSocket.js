const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");

let ioRef = null;

function init(io) {
  ioRef = io;
}

/**
 * Admin sockets carry financial/KYC/orders data across cities.
 * admin:join requires the JWT issued on login and is verified server-side.
 */
function registerAdminHandlers(io, socket) {
  socket.on("admin:join", ({ token }) => {
    try {
      if (!token) {
        socket.emit("admin:join:ack", { Result: false, msg: "Token missing" });
        return;
      }
      const rawToken = String(token).replace(/^Bearer\s+/i, "").trim();
      const payload = jwt.verify(rawToken, process.env.JWT_SECRET);
      socket.data.adminId = payload.id;
      socket.data.adminRole = payload.role;
      socket.data.adminCityId = payload.city_id;

      // Join universal admin room so global dashboard events reach all authorized staff
      socket.join("admins_all");

      const roleLower = String(payload.role || "").toLowerCase();
      if (roleLower === "superadmin" || roleLower === "super_admin") {
        socket.join("admin_super");
      }
      if (payload.city_id) {
        socket.join(`admin_city_${payload.city_id}`);
      }

      socket.emit("admin:join:ack", { Result: true, role: payload.role, city_id: payload.city_id });
      logger.info(`Admin #${payload.id} (${payload.role}) joined admin rooms`);
    } catch (err) {
      logger.warn("admin:join failed:", err?.message);
      socket.emit("admin:join:ack", { Result: false, msg: "Invalid or expired token" });
    }
  });
}

function requireIo() {
  if (!ioRef) {
    throw new Error("adminSocket.init(io) must be called before broadcasting admin events");
  }
  return ioRef;
}

function broadcastToScope(cityId, event, payload) {
  try {
    if (!ioRef) return;
    ioRef.to("admins_all").emit(event, payload);
    ioRef.to("admin_super").emit(event, payload);
    if (cityId) {
      ioRef.to(`admin_city_${cityId}`).emit(event, payload);
    }
    // Universal broadcast to all active connections
    ioRef.emit(event, payload);
  } catch (err) {
    logger.error(`broadcastToScope error for event ${event}:`, err);
  }
}

function notifyNewOrder(order) {
  broadcastToScope(order?.city_id, "admin:new_order", {
    order_id: order?.id,
    city_id: order?.city_id,
    category: order?.category,
    pickup_address: order?.paddress,
    delivery_address: order?.daddress,
    customer_name: order?.pick_name,
    customer_mobile: order?.pmobile,
    booking_type: order?.booking_type,
    total_dcharge: String(order?.total_dcharge || "0"),
    odate: order?.odate,
    timestamp: Date.now(),
  });
}

function notifyOrderStatusUpdate(order) {
  broadcastToScope(order?.city_id, "admin:order_status_update", {
    order_id: order?.id,
    order_status: order?.order_status,
    o_status: order?.o_status,
    rid: order?.rid,
    city_id: order?.city_id,
    timestamp: Date.now(),
  });
}

/** Fired when a dispatch cascade exhausts all tiers with no acceptance */
function notifyDispatchAlert(orderId, cityId, message) {
  broadcastToScope(cityId, "admin:dispatch_alert", {
    order_id: orderId,
    city_id: cityId,
    message: message || `Attention: Order #${orderId} requires manual assignment!`,
    timestamp: Date.now(),
  });
}

function notifyDriverKycSubmitted(rider) {
  broadcastToScope(rider?.city_id, "admin:driver_kyc_submitted", {
    rider_id: rider?.id,
    city_id: rider?.city_id,
    full_name: rider?.full_name || `${rider?.first_name || ""} ${rider?.last_name || ""}`.trim(),
    timestamp: Date.now(),
  });
}

function notifyDriverKycUpdate(riderId, cityId, kycData) {
  broadcastToScope(cityId, "admin:driver_kyc_update", {
    rider_id: riderId,
    city_id: cityId,
    ...kycData,
    timestamp: Date.now(),
  });
}

function notifyDriverStatusUpdate(riderId, cityId, statusData) {
  broadcastToScope(cityId, "admin:driver_status_update", {
    rider_id: riderId,
    city_id: cityId,
    ...statusData,
    timestamp: Date.now(),
  });
}

function notifyCustomOrderUpdate(customOrder) {
  broadcastToScope(customOrder?.city_id, "admin:custom_order_update", {
    order_id: customOrder?.id,
    city_id: customOrder?.city_id,
    status: customOrder?.status,
    ...customOrder,
    timestamp: Date.now(),
  });
}

function notifyPayoutRequest(payout) {
  broadcastToScope(payout?.city_id, "admin:payout_request", {
    payout_id: payout?.id,
    rider_id: payout?.rider_id,
    amount: payout?.amount,
    status: payout?.status || "pending",
    timestamp: Date.now(),
  });
}

function notifyPayoutUpdate(payout) {
  broadcastToScope(payout?.city_id, "admin:payout_update", {
    payout_id: payout?.id,
    rider_id: payout?.rider_id,
    status: payout?.status,
    amount: payout?.amount,
    timestamp: Date.now(),
  });
}

function notifyDashboardRefresh(cityId) {
  broadcastToScope(cityId, "admin:dashboard_refresh", {
    city_id: cityId,
    timestamp: Date.now(),
  });
}

function notifyLiveDriverPing(riderId, cityId, lat, lng, heading) {
  try {
    const io = requireIo();
    const payload = {
      rider_id: riderId,
      lat,
      lng,
      heading: heading ?? null,
      timestamp: Date.now(),
    };
    io.to("admins_all").emit("admin:live_driver_ping", payload);
    io.to("admin_super").emit("admin:live_driver_ping", payload);
    if (cityId) {
      io.to(`admin_city_${cityId}`).emit("admin:live_driver_ping", payload);
    }
  } catch (err) {
    logger.error("notifyLiveDriverPing error:", err);
  }
}

module.exports = {
  init,
  registerAdminHandlers,
  notifyNewOrder,
  notifyOrderStatusUpdate,
  notifyDispatchAlert,
  notifyDriverKycSubmitted,
  notifyDriverKycUpdate,
  notifyDriverStatusUpdate,
  notifyCustomOrderUpdate,
  notifyPayoutRequest,
  notifyPayoutUpdate,
  notifyDashboardRefresh,
  notifyLiveDriverPing,
};
