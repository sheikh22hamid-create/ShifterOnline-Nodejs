const prisma = require("../config/db");
const logger = require("../utils/logger");

// A customer can mark any of their own completed orders as a favourite so it
// shows in the Orders > Favorite tab for quick re-booking. Calling this again
// for an already-favourited order removes it.
async function toggleFavoriteOrder(req, res) {
  try {
    const userId = Number(req.body?.user_id || req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!userId || !orderId) return res.status(200).json({ Result: false, msg: "user_id and order_id required" });

    const existing = await prisma.tbl_user_favorite_order.findUnique({
      where: { user_id_order_id: { user_id: userId, order_id: orderId } },
    });
    if (existing) {
      await prisma.tbl_user_favorite_order.delete({ where: { id: existing.id } });
      return res.status(200).json({ Result: true, msg: "Removed from favorites", favorite: false });
    }

    const order = await prisma.pkg_order.findFirst({ where: { id: orderId, uid: userId }, select: { id: true } });
    if (!order) return res.status(200).json({ Result: false, msg: "Order not found" });

    await prisma.tbl_user_favorite_order.create({ data: { user_id: userId, order_id: orderId } });
    return res.status(200).json({ Result: true, msg: "Added to favorites", favorite: true });
  } catch (err) {
    logger.error("favoriteOrder.toggle failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

module.exports = { toggleFavoriteOrder };
