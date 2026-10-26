const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("../services/customiseOrderSettings");
const service = require("../services/customiseOrderService");

// HTTP layer for Customise Order. Customer and driver endpoints use the legacy custom-order response shape
// ({ Result, msg, ... }, HTTP 200); admin endpoints use the admin panel's { success, data }. The kill switch
// customise_order_enabled guards every customer/driver call. All rules live in customiseOrderService.

const send = (res, out, pick = (o) => o) => {
  if (!out.ok) return res.status(200).json({ Result: false, msg: out.msg, ...(out.errors ? { errors: out.errors } : {}) });
  return res.status(200).json({ Result: true, ...pick(out) });
};

async function guarded(req, res, idField, run) {
  try {
    if (!(await settings.isEnabled())) return res.status(200).json({ Result: false, msg: "Customise Order is not available" });
    const id = Number(req.body?.[idField] || 0);
    if (!id) return res.status(200).json({ Result: false, msg: `${idField} is required` });
    return await run(id, req.body || {});
  } catch (err) {
    logger.error("customiseOrderController failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

// --- customer -----------------------------------------------------------------------------------------------------
const create = (req, res) => guarded(req, res, "user_id", async (uid, b) => send(res, await service.createOrder(uid, b), (o) => ({ order_id: o.order_id })));
const mine = (req, res) => guarded(req, res, "user_id", async (uid) => send(res, await service.myOrders(uid), (o) => ({ orders: o.orders })));
const detail = (req, res) => guarded(req, res, "user_id", async (uid, b) => send(res, await service.getOrder(Number(b.order_id), uid), (o) => ({ order: o.order, offers: o.offers })));
const offers = (req, res) => guarded(req, res, "user_id", async (uid, b) => send(res, await service.listOffers(Number(b.order_id), uid), (o) => ({ offers: o.offers })));
const acceptOffer = (req, res) => guarded(req, res, "user_id", async (uid, b) => send(res, await service.customerAcceptOffer(Number(b.order_id), uid, Number(b.offer_id)), (o) => ({ pkg_order_id: o.pkg_order_id })));
const rejectOffer = (req, res) => guarded(req, res, "user_id", async (uid, b) => send(res, await service.customerRejectOffer(Number(b.order_id), uid, Number(b.offer_id))));
const cancel = (req, res) => guarded(req, res, "user_id", async (uid, b) => send(res, await service.customerCancel(Number(b.order_id), uid)));

// --- driver -------------------------------------------------------------------------------------------------------
const driverList = (req, res) => guarded(req, res, "rider_id", async (rid) => send(res, await service.listOpenForDriver(rid), (o) => ({ orders: o.orders, count: o.count })));
const driverCount = (req, res) => guarded(req, res, "rider_id", async (rid) => send(res, await service.listOpenForDriver(rid), (o) => ({ count: o.count })));
const driverAccept = (req, res) => guarded(req, res, "rider_id", async (rid, b) => send(res, await service.driverAccept(Number(b.order_id), rid), (o) => ({ pkg_order_id: o.pkg_order_id, fare: o.fare })));
const driverCounter = (req, res) => guarded(req, res, "rider_id", async (rid, b) => send(res, await service.driverCounter(Number(b.order_id), rid, b.amount), (o) => ({ offer_id: o.offer_id })));
const driverDismiss = (req, res) => guarded(req, res, "rider_id", async (rid, b) => send(res, await service.driverDismiss(Number(b.order_id), rid)));

// --- admin (read only) --------------------------------------------------------------------------------------------
async function adminList(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;
    if (req.query?.status) where.status = String(req.query.status);
    const rows = await prisma.customise_order.findMany({ where, orderBy: { id: "desc" }, take: 500 });
    const ids = rows.map((r) => r.id);
    const [offers, users] = await Promise.all([
      ids.length ? prisma.customise_offer.findMany({ where: { order_id: { in: ids } } }) : [],
      rows.length ? prisma.tbl_user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.uid))] } }, select: { id: true, name: true, mobile: true } }) : [],
    ]);
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    const data = rows.map((r) => ({
      ...r,
      customer: userById[r.uid] || null,
      offer_count: offers.filter((o) => o.order_id === r.id).length,
    }));
    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    logger.error("customiseOrderController.adminList failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function adminDetail(req, res) {
  try {
    const id = Number(req.params.id);
    const order = await prisma.customise_order.findUnique({ where: { id } });
    if (!order || (req.scopedCityId && order.city_id !== req.scopedCityId)) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    const [stops, offers, events, timers] = await Promise.all([
      prisma.customise_order_stop.findMany({ where: { order_id: id }, orderBy: { seq: "asc" } }),
      prisma.customise_offer.findMany({ where: { order_id: id }, orderBy: { id: "asc" } }),
      prisma.customise_event.findMany({ where: { order_id: id }, orderBy: { id: "asc" } }),
      prisma.customise_order_timer.findMany({ where: { order_id: id }, orderBy: { id: "asc" } }),
    ]);
    const riderIds = [...new Set(offers.map((o) => o.rider_id))];
    const riders = riderIds.length ? await prisma.tbl_rider.findMany({ where: { id: { in: riderIds } }, select: { id: true, first_name: true, vehicle: true } }) : [];
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));
    return res.status(200).json({
      success: true,
      data: { order, stops, timers, offers: offers.map((o) => ({ ...o, driver_name: riderById[o.rider_id]?.first_name || null, vehicle: riderById[o.rider_id]?.vehicle || null })), events },
    });
  } catch (err) {
    logger.error("customiseOrderController.adminDetail failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = {
  create, mine, detail, offers, acceptOffer, rejectOffer, cancel,
  driverList, driverCount, driverAccept, driverCounter, driverDismiss,
  adminList, adminDetail,
};
