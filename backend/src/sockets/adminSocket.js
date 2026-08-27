const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");

let ioRef = null;

function init(io) {
  ioRef = io;
}

/**
 * Unlike driver:join/customer:join (which trust a client-supplied id with no
 * auth — see memory/order_dispatch_auth_gap.md), admin sockets carry
 * financial/KYC/PII data across every city, so admin:join requires the same
 * JWT issued by POST /auth/login and is verified server-side — role/city_id
 * come from the verified payload, never from the client.
 */
function registerAdminHandlers(io, socket) {
  socket.on("admin:join", ({ token }) => {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.adminId = payload.id;
      socket.data.adminRole = payload.role;
      socket.data.adminCityId = payload.city_id;

      if (payload.role === "superadmin") {
        socket.join("admin_super");
      } else {
        socket.join(`admin_city_${payload.city_id}`);
      }

      socket.emit("admin:join:ack", { Result: true });
    } catch (err) {
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

/** Broadcasts to admin_super plus the order/rider's city room, if known. */
function broadcastToScope(cityId, event, payload) {
  const io = requireIo();
  io.to("admin_super").emit(event, payload);
  if (cityId) io.to(`admin_city_${cityId}`).emit(event, payload);
}

function notifyNewOrder(order) {
  broadcastToScope(order.city_id, "admin:new_order", {
    order_id: order.id,
    city_id: order.city_id,
    category: order.category,
    pickup_address: order.paddress,
    total_dcharge: String(order.total_dcharge),
    odate: order.odate,
  });
}

function notifyOrderStatusUpdate(order) {
  broadcastToScope(order.city_id, "admin:order_status_update", {
    order_id: order.id,
    order_status: order.order_status,
    o_status: order.o_status,
    rid: order.rid,
  });
}

/** Fired when a dispatch cascade exhausts all tiers with no acceptance (spec §5.2.3). */
function notifyDispatchAlert(orderId, cityId, message) {
  broadcastToScope(cityId, "admin:dispatch_alert", {
    order_id: orderId,
    message: message || `Attention: Order #${orderId} requires manual assignment!`,
  });
}

/** No current producer for this — no driver-side KYC document upload
 * endpoint exists yet in this codebase. Exported so Phase 3's kyc-decision
 * flow (or a future upload endpoint) can call it. */
function notifyDriverKycSubmitted(rider) {
  broadcastToScope(rider.city_id, "admin:driver_kyc_submitted", {
    rider_id: rider.id,
    full_name: rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
  });
}

function notifyLiveDriverPing(riderId, cityId, lat, lng, heading) {
  if (!cityId) return;
  requireIo().to(`admin_city_${cityId}`).to("admin_super").emit("admin:live_driver_ping", {
    rider_id: riderId,
    lat,
    lng,
    heading: heading ?? null,
  });
}

module.exports = {
  init,
  registerAdminHandlers,
  notifyNewOrder,
  notifyOrderStatusUpdate,
  notifyDispatchAlert,
  notifyDriverKycSubmitted,
  notifyLiveDriverPing,
};
