const prisma = require("../config/db");
const dispatchManager = require("../services/dispatchManager");
const logger = require("../utils/logger");

/**
 * Gets the order queue for a driver (both active trip and pending queue).
 */
async function getDriverQueue(req, res) {
  try {
    const riderId = req.params.riderId || req.query.riderId;
    if (!riderId) {
      return res.status(400).json({ success: false, message: "riderId required" });
    }

    const queueItems = await prisma.driver_order_queue.findMany({
      where: {
        rider_id: Number(riderId),
        status: { in: ["pending", "active"] },
      },
      orderBy: { queue_order: "asc" },
    });

    const orderIds = queueItems.map((q) => q.order_id);
    const orders = await prisma.pkg_order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        uid: true,
        o_status: true,
        pick_address: true,
        drop_address: true,
        pickup_name: true,
        drop_name: true,
        distance: true,
        time_duration: true,
        total_dcharge: true,
        sub_total: true,
        order_date: true,
      },
    });

    const orderMap = new Map(orders.map((o) => [o.id, o]));

    const result = queueItems.map((item) => ({
      ...item,
      order: orderMap.get(item.order_id) || null,
    }));

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error("Error fetching driver queue:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Admin assigns an order to a monthly driver in their queue.
 */
async function assignOrderToQueue(req, res) {
  try {
    const { order_id, rider_id, position } = req.body;

    if (!order_id || !rider_id) {
      return res.status(400).json({ success: false, message: "order_id and rider_id are required" });
    }

    const orderId = Number(order_id);
    const riderId = Number(rider_id);

    // Verify driver is monthly driver
    const contract = await prisma.monthly_driver_contract.findUnique({
      where: { rider_id: riderId },
    });
    if (!contract || contract.status !== "active") {
      return res.status(400).json({ success: false, message: "Driver is not an active Monthly Dedicated Driver" });
    }

    // Check if driver currently has an active order in progress
    const activeOrder = await prisma.pkg_order.findFirst({
      where: {
        rid: riderId,
        o_status: { in: ["Processing", "On_Route", "Pickup"] },
      },
    });

    const existingQueueCount = await prisma.driver_order_queue.count({
      where: { rider_id: riderId, status: "pending" },
    });

    const queueOrder = position === "next" ? 1 : existingQueueCount + 1;

    // If driver is completely free (no active order), assign immediately
    if (!activeOrder) {
      await prisma.pkg_order.update({
        where: { id: orderId },
        data: {
          rid: riderId,
          o_status: "Processing",
          flow_id: 1,
        },
      });

      await prisma.driver_order_queue.create({
        data: {
          rider_id: riderId,
          order_id: orderId,
          queue_order: 1,
          status: "active",
        },
      });

      // Emit direct assign to driver via socket
      try {
        const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
        if (order) {
          dispatchManager.emitDirectAssign(riderId, order);
        }
      } catch (socketErr) {
        logger.warn("Socket direct assign notification error:", socketErr);
      }

      return res.json({
        success: true,
        message: "Order directly assigned and activated for Monthly Driver",
        isActivated: true,
      });
    }

    // Otherwise, place in pending queue
    const queued = await prisma.driver_order_queue.create({
      data: {
        rider_id: riderId,
        order_id: orderId,
        queue_order: queueOrder,
        status: "pending",
      },
    });

    // Notify driver about new queued order
    try {
      dispatchManager.emitQueueUpdate(riderId);
    } catch (ignored) {}

    return res.json({
      success: true,
      message: "Order successfully added to driver's upcoming queue",
      isActivated: false,
      data: queued,
    });
  } catch (err) {
    logger.error("Error assigning order to queue:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Removes an order from a driver's queue.
 */
async function removeOrderFromQueue(req, res) {
  try {
    const { queue_id } = req.params;
    const item = await prisma.driver_order_queue.findUnique({
      where: { id: Number(queue_id) },
    });

    if (!item) {
      return res.status(404).json({ success: false, message: "Queue item not found" });
    }

    await prisma.driver_order_queue.update({
      where: { id: Number(queue_id) },
      data: { status: "cancelled" },
    });

    try {
      dispatchManager.emitQueueUpdate(item.rider_id);
    } catch (ignored) {}

    return res.json({ success: true, message: "Order removed from queue" });
  } catch (err) {
    logger.error("Error removing order from queue:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = {
  getDriverQueue,
  assignOrderToQueue,
  removeOrderFromQueue,
};
