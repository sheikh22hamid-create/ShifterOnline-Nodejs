const prisma = require("../config/db");
const logger = require("../utils/logger");
const dispatchManager = require("./dispatchManager");
const pushNotifier = require("./pushNotifier");
const settings = require("./customiseOrderSettings");
const rules = require("./customiseOrderRules");

// Customise Order negotiation (spec 2026-10-26). Every offer write locks the customise_order row so the status,
// start/expiry window and eligibility checks and the insert happen atomically; all comparisons use the server
// clock. Offers and events are append-only: an offer only ever changes status. Every function returns
// { ok, msg?, ... } and never throws. Conversion to a real ride lives in customiseConvertService (required lazily:
// it requires this module's logEvent back).
const convertService = () => require("./customiseConvertService");

const NOT_AVAILABLE = "Customise Order is not available";
const REASON_MSG = {
  not_started: "Bargaining on this order has not started yet",
  expired: "This order has expired",
  not_open: "This order is no longer available",
};
const OPEN_STATUSES = ["open", "scheduled"];

const fail = (msg, extra = {}) => ({ ok: false, msg, ...extra });
const num = (v) => (v == null ? null : Number(v));

async function logEvent(client, orderId, type, riderId = null, meta = null) {
  await client.customise_event.create({ data: { order_id: orderId, rider_id: riderId, type, meta } });
}

const lockOrder = async (tx, orderId) =>
  (await tx.$queryRaw`SELECT * FROM customise_order WHERE id = ${Number(orderId)} FOR UPDATE`)[0] || null;

async function categoriesByName() {
  const rows = await prisma.pkg_category.findMany({ where: { cat_status: 1 } });
  return new Map(rows.map((c) => [String(c.cat_name).trim().toLowerCase(), c]));
}
const categoryOf = (map, vehicle) => map.get(String(vehicle || "").trim().toLowerCase()) || null;

// --- create ------------------------------------------------------------------------------------------------------

async function createOrder(uid, body, { now = new Date() } = {}) {
  try {
    if (!(await settings.isEnabled())) return fail(NOT_AVAILABLE);
    const bounds = await settings.getBounds();
    const checked = rules.validateCreate(body, now, bounds);
    if (!checked.ok) return fail(checked.errors[0], { errors: checked.errors });
    const v = checked.value;

    const [user, category] = await Promise.all([
      prisma.tbl_user.findUnique({ where: { id: Number(uid) }, select: { city_id: true } }),
      v.category_id ? prisma.pkg_category.findFirst({ where: { id: v.category_id } }) : Promise.resolve(null),
    ]);
    if (v.category_id && !category) return fail("Selected vehicle category was not found");

    const status = v.bargain_start_at.getTime() <= now.getTime() ? "open" : "scheduled";
    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.customise_order.create({
        data: {
          uid: Number(uid), city_id: user?.city_id ?? null, category_id: category?.id ?? null, category_name: category?.cat_name ?? null, status,
          p_lat: v.pickup.lat, p_lng: v.pickup.lng, p_address: v.pickup.address, p_exact: v.pickup.exact,
          d_lat: v.drop.lat, d_lng: v.drop.lng, d_address: v.drop.address,
          goods_desc: v.goods.description, goods_qty: v.goods.quantity, goods_weight_kg: v.goods.weight_kg,
          goods_len_cm: v.goods.length_cm, goods_wid_cm: v.goods.width_cm, goods_hgt_cm: v.goods.height_cm, packing_notes: v.goods.packing_notes,
          p_floor: v.pickup_handling.floor, p_carry_m: v.pickup_handling.carry_m, p_helpers: v.pickup_handling.helpers,
          p_load_min: v.pickup_handling.load_min, p_wait_min: v.pickup_handling.wait_min, p_notes: v.pickup_handling.notes,
          d_floor: v.drop_handling.floor, d_carry_m: v.drop_handling.carry_m, d_helpers: v.drop_handling.helpers,
          d_unload_min: v.drop_handling.unload_min, d_wait_min: v.drop_handling.wait_min, d_notes: v.drop_handling.notes,
          initial_fare: v.initial_fare, p_method_id: v.p_method_id, bargain_start_at: v.bargain_start_at, expires_at: v.expires_at,
        },
      });
      if (v.stops.length) await tx.customise_order_stop.createMany({ data: v.stops.map((s) => ({ ...s, order_id: order.id })) });
      await logEvent(tx, order.id, "created", null, { initial_fare: v.initial_fare, status });
      return order;
    });

    if (status === "open") notifyEligible(created, { now }).catch((err) => logger.error(`customise notifyEligible ${created.id}:`, err));
    return { ok: true, order_id: created.id };
  } catch (err) {
    logger.error("customiseOrderService.createOrder failed:", err);
    return fail("Internal server error");
  }
}

// --- driver side -------------------------------------------------------------------------------------------------

function driverView(order, stops, myOffer) {
  return {
    order_id: order.id,
    pickup: { lat: num(order.p_lat), lng: num(order.p_lng), address: order.p_address, exact: Boolean(order.p_exact) },
    drop: { lat: num(order.d_lat), lng: num(order.d_lng), address: order.d_address },
    stops: stops.map((s) => ({
      seq: s.seq, lat: num(s.lat), lng: num(s.lng), address: s.address, kind: s.kind, goods_desc: s.goods_desc, floor: s.floor,
      carry_m: s.carry_m, helpers: s.helpers, load_min: s.load_min, unload_min: s.unload_min, wait_min: s.wait_min, notes: s.notes,
    })),
    goods: {
      description: order.goods_desc, quantity: order.goods_qty, weight_kg: num(order.goods_weight_kg), length_cm: num(order.goods_len_cm),
      width_cm: num(order.goods_wid_cm), height_cm: num(order.goods_hgt_cm), packing_notes: order.packing_notes,
    },
    pickup_handling: { floor: order.p_floor, carry_m: order.p_carry_m, helpers: order.p_helpers, load_min: order.p_load_min, wait_min: order.p_wait_min, notes: order.p_notes },
    drop_handling: { floor: order.d_floor, carry_m: order.d_carry_m, helpers: order.d_helpers, unload_min: order.d_unload_min, wait_min: order.d_wait_min, notes: order.d_notes },
    category: order.category_name || null,
    initial_fare: num(order.initial_fare),
    bargain_start_at: order.bargain_start_at,
    expires_at: order.expires_at,
    my_offer: myOffer ? { offer_id: myOffer.id, amount: num(myOffer.amount), kind: myOffer.kind, status: myOffer.status } : null,
  };
}

/** Orders this driver can act on right now. count is what the app's badge shows. */
async function listOpenForDriver(riderId, { now = new Date() } = {}) {
  try {
    if (!(await settings.isEnabled())) return { ok: true, orders: [], count: 0 };
    const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) } });
    if (!rider || rider.status !== 1) return { ok: true, orders: [], count: 0 };

    const where = { status: "open", bargain_start_at: { lte: now }, expires_at: { gt: now } };
    if (rider.city_id != null) where.city_id = rider.city_id;
    const orders = await prisma.customise_order.findMany({ where, orderBy: { id: "desc" } });
    if (!orders.length) return { ok: true, orders: [], count: 0 };

    const ids = orders.map((o) => o.id);
    const [categories, dismissals, stops, offers] = await Promise.all([
      categoriesByName(),
      prisma.customise_dismissal.findMany({ where: { rider_id: rider.id, order_id: { in: ids } } }),
      prisma.customise_order_stop.findMany({ where: { order_id: { in: ids } }, orderBy: { seq: "asc" } }),
      prisma.customise_offer.findMany({ where: { order_id: { in: ids }, rider_id: rider.id, status: "active" } }),
    ]);
    const dismissed = new Set(dismissals.map((d) => d.order_id));
    const category = categoryOf(categories, rider.vehicle);

    const visible = orders.filter((o) => rules.driverEligible({ order: o, rider, category, dismissed: dismissed.has(o.id) }));
    return {
      ok: true,
      count: visible.length,
      orders: visible.map((o) => driverView(o, stops.filter((s) => s.order_id === o.id), offers.find((f) => f.order_id === o.id))),
    };
  } catch (err) {
    logger.error("customiseOrderService.listOpenForDriver failed:", err);
    return fail("Internal server error");
  }
}

/** Locks the order, re-checks window + eligibility, supersedes the driver's earlier active offer and inserts the new one. */
async function placeOffer(orderId, riderId, kind, amountIn, now) {
  const bounds = await settings.getBounds();
  let customerNotice = null;
  const result = await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) return fail("Order not found");
    const window = rules.isBiddable(order, now);
    if (!window.ok) return fail(REASON_MSG[window.reason]);

    const amount = kind === "accept" ? Number(order.initial_fare) : Number(amountIn);
    if (!Number.isFinite(amount) || amount < bounds.minFare || amount > bounds.maxFare) {
      return fail(`Your price must be between ${bounds.minFare} and ${bounds.maxFare}`);
    }

    const rider = await tx.tbl_rider.findUnique({ where: { id: Number(riderId) } });
    if (!rider || rider.status !== 1) return fail("Your account is not approved");
    if (rider.a_status !== 1) return fail("Go online to take Customise Orders");
    const [categories, dismissals] = await Promise.all([
      categoriesByName(),
      tx.customise_dismissal.findMany({ where: { order_id: order.id, rider_id: rider.id } }),
    ]);
    const eligible = rules.driverEligible({ order, rider, category: categoryOf(categories, rider.vehicle), dismissed: dismissals.length > 0 });
    if (!eligible) return fail("This order is not available for your vehicle");

    await tx.customise_offer.updateMany({ where: { order_id: order.id, rider_id: rider.id, status: "active" }, data: { status: "superseded", decided_at: now } });
    const offer = await tx.customise_offer.create({ data: { order_id: order.id, rider_id: rider.id, kind, amount, status: "active" } });
    await logEvent(tx, order.id, kind === "accept" ? "driver_accept" : "driver_counter", rider.id, { amount, offer_id: offer.id });
    customerNotice = { uid: order.uid, payload: { order_id: order.id, offer_id: offer.id, rider_id: rider.id, amount, kind, driver_name: rider.first_name || null } };
    return { ok: true, offer_id: offer.id, amount };
  });

  if (result.ok && customerNotice) notifyCustomerOfOffer(customerNotice).catch((err) => logger.error("customise offer notify failed:", err));
  return result;
}

async function notifyCustomerOfOffer({ uid, payload }) {
  dispatchManager.emitCustomerEvent(uid, "customise:offer", payload);
  const user = await prisma.tbl_user.findUnique({ where: { id: uid }, select: { fcm_token: true } });
  if (user?.fcm_token) {
    await pushNotifier.notifyCustomerCustomiseOffer(user.fcm_token, { orderId: payload.order_id, driverName: payload.driver_name, amount: payload.amount });
  }
}

async function driverCounter(orderId, riderId, amount, { now = new Date() } = {}) {
  try {
    if (!(await settings.isEnabled())) return fail(NOT_AVAILABLE);
    return await placeOffer(Number(orderId), Number(riderId), "counter", amount, now);
  } catch (err) {
    logger.error("customiseOrderService.driverCounter failed:", err);
    return fail("Internal server error");
  }
}

/** The driver takes the customer's price: record it, then convert straight away (first valid taker wins). */
async function driverAccept(orderId, riderId, { now = new Date() } = {}) {
  try {
    if (!(await settings.isEnabled())) return fail(NOT_AVAILABLE);
    const placed = await placeOffer(Number(orderId), Number(riderId), "accept", null, now);
    if (!placed.ok) return placed;
    const converted = await convertService().convert(Number(orderId), placed.offer_id);
    if (!converted.ok) {
      await prisma.customise_offer.updateMany({ where: { id: placed.offer_id, status: "active" }, data: { status: "withdrawn", decided_at: now } });
      return fail(converted.msg || "Could not accept this order");
    }
    return { ok: true, pkg_order_id: converted.pkg_order_id, fare: placed.amount };
  } catch (err) {
    logger.error("customiseOrderService.driverAccept failed:", err);
    return fail("Internal server error");
  }
}

async function driverDismiss(orderId, riderId, { now = new Date() } = {}) {
  try {
    if (!(await settings.isEnabled())) return fail(NOT_AVAILABLE);
    const key = { order_id: Number(orderId), rider_id: Number(riderId) };
    await prisma.customise_dismissal.upsert({ where: { order_id_rider_id: key }, create: key, update: {} });
    await prisma.customise_offer.updateMany({ where: { ...key, status: "active" }, data: { status: "withdrawn", decided_at: now } });
    return { ok: true };
  } catch (err) {
    logger.error("customiseOrderService.driverDismiss failed:", err);
    return fail("Internal server error");
  }
}

// --- customer side -----------------------------------------------------------------------------------------------

async function ownedOrder(orderId, uid) {
  const order = await prisma.customise_order.findUnique({ where: { id: Number(orderId) } });
  return order && Number(order.uid) === Number(uid) ? order : null;
}

async function myOrders(uid) {
  try {
    const orders = await prisma.customise_order.findMany({ where: { uid: Number(uid) }, orderBy: { id: "desc" } });
    const offers = orders.length
      ? await prisma.customise_offer.findMany({ where: { order_id: { in: orders.map((o) => o.id) }, status: "active" } })
      : [];
    return {
      ok: true,
      orders: orders.map((o) => ({
        order_id: o.id, status: o.status, pickup_address: o.p_address, drop_address: o.d_address, goods_desc: o.goods_desc,
        initial_fare: num(o.initial_fare), agreed_fare: num(o.agreed_fare), bargain_start_at: o.bargain_start_at, expires_at: o.expires_at,
        pkg_order_id: o.pkg_order_id, offer_count: offers.filter((f) => f.order_id === o.id).length,
      })),
    };
  } catch (err) {
    logger.error("customiseOrderService.myOrders failed:", err);
    return fail("Internal server error");
  }
}

async function listOffers(orderId, uid) {
  try {
    const order = await ownedOrder(orderId, uid);
    if (!order) return fail("Order not found");
    const offers = await prisma.customise_offer.findMany({ where: { order_id: order.id, status: "active" }, orderBy: { amount: "asc" } });
    const riders = offers.length
      ? await prisma.tbl_rider.findMany({ where: { id: { in: [...new Set(offers.map((o) => o.rider_id))] } }, select: { id: true, first_name: true, vehicle: true } })
      : [];
    const byId = Object.fromEntries(riders.map((r) => [r.id, r]));
    return {
      ok: true,
      offers: offers.map((o) => ({
        offer_id: o.id, rider_id: o.rider_id, driver_name: byId[o.rider_id]?.first_name || null, vehicle: byId[o.rider_id]?.vehicle || null,
        amount: num(o.amount), kind: o.kind, status: o.status, created_at: o.created_at,
      })),
    };
  } catch (err) {
    logger.error("customiseOrderService.listOffers failed:", err);
    return fail("Internal server error");
  }
}

async function getOrder(orderId, uid) {
  try {
    const order = await ownedOrder(orderId, uid);
    if (!order) return fail("Order not found");
    const [stops, offers] = await Promise.all([
      prisma.customise_order_stop.findMany({ where: { order_id: order.id }, orderBy: { seq: "asc" } }),
      listOffers(orderId, uid),
    ]);
    return {
      ok: true,
      order: { ...driverView(order, stops, null), status: order.status, agreed_fare: num(order.agreed_fare), pkg_order_id: order.pkg_order_id },
      offers: offers.offers || [],
    };
  } catch (err) {
    logger.error("customiseOrderService.getOrder failed:", err);
    return fail("Internal server error");
  }
}

async function customerAcceptOffer(orderId, uid, offerId) {
  try {
    if (!(await settings.isEnabled())) return fail(NOT_AVAILABLE);
    if (!(await ownedOrder(orderId, uid))) return fail("Order not found");
    // The offer must be an active one on THIS order: an id from another customer's order must never convert this one.
    const offer = await prisma.customise_offer.findFirst({ where: { id: Number(offerId), order_id: Number(orderId), status: "active" } });
    if (!offer) return fail("This offer is no longer available");
    const converted = await convertService().convert(Number(orderId), Number(offerId));
    return converted.ok ? { ok: true, pkg_order_id: converted.pkg_order_id } : fail(converted.msg || "Could not accept this offer");
  } catch (err) {
    logger.error("customiseOrderService.customerAcceptOffer failed:", err);
    return fail("Internal server error");
  }
}

async function customerRejectOffer(orderId, uid, offerId, { now = new Date() } = {}) {
  try {
    if (!(await ownedOrder(orderId, uid))) return fail("Order not found");
    const offer = await prisma.customise_offer.findFirst({ where: { id: Number(offerId), order_id: Number(orderId) } });
    if (!offer || offer.status !== "active") return fail("This offer is no longer active");
    await prisma.customise_offer.updateMany({ where: { id: offer.id, status: "active" }, data: { status: "rejected_by_customer", decided_at: now } });
    await logEvent(prisma, offer.order_id, "customer_reject", offer.rider_id, { offer_id: offer.id });
    dispatchManager.emitDriverEvent(offer.rider_id, "customise:offer_rejected", { order_id: offer.order_id, offer_id: offer.id });
    return { ok: true };
  } catch (err) {
    logger.error("customiseOrderService.customerRejectOffer failed:", err);
    return fail("Internal server error");
  }
}

/** Phase 1: only before a driver is assigned. Cancelling an assigned job (with its penalty) is Phase 3. */
async function customerCancel(orderId, uid, { now = new Date() } = {}) {
  try {
    const biddingRiders = [];
    const result = await prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (!order || Number(order.uid) !== Number(uid)) return fail("Order not found");
      if (!OPEN_STATUSES.includes(order.status)) return fail("This order can no longer be cancelled here");
      const offers = await tx.customise_offer.findMany({ where: { order_id: order.id, status: "active" } });
      biddingRiders.push(...new Set(offers.map((o) => o.rider_id)));
      await tx.customise_order.update({ where: { id: order.id }, data: { status: "cancelled" } });
      await tx.customise_offer.updateMany({ where: { order_id: order.id, status: "active" }, data: { status: "void", decided_at: now } });
      await logEvent(tx, order.id, "customer_cancel");
      return { ok: true };
    });
    if (result.ok) biddingRiders.forEach((id) => dispatchManager.emitDriverEvent(id, "customise:closed", { order_id: Number(orderId), reason: "cancelled" }));
    return result;
  } catch (err) {
    logger.error("customiseOrderService.customerCancel failed:", err);
    return fail("Internal server error");
  }
}

// --- sweeps and notifications ------------------------------------------------------------------------------------

async function expireDue(now = new Date()) {
  let expired = 0;
  try {
    const due = await prisma.customise_order.findMany({ where: { status: { in: OPEN_STATUSES }, expires_at: { lte: now } } });
    for (const order of due) {
      const moved = await prisma.customise_order.updateMany({ where: { id: order.id, status: { in: OPEN_STATUSES } }, data: { status: "expired" } });
      if (moved && moved.count === 0) continue;
      const offers = await prisma.customise_offer.findMany({ where: { order_id: order.id, status: "active" } });
      await prisma.customise_offer.updateMany({ where: { order_id: order.id, status: "active" }, data: { status: "void", decided_at: now } });
      await logEvent(prisma, order.id, "expired");
      new Set(offers.map((o) => o.rider_id)).forEach((id) => dispatchManager.emitDriverEvent(id, "customise:closed", { order_id: order.id, reason: "expired" }));
      dispatchManager.emitCustomerEvent(order.uid, "customise:expired", { order_id: order.id });
      expired += 1;
    }
  } catch (err) {
    logger.error("customiseOrderService.expireDue failed:", err);
  }
  return expired;
}

/** Scheduled orders whose bargaining start has arrived become open and are announced to eligible drivers. */
async function activateDue(now = new Date()) {
  let opened = 0;
  try {
    const due = await prisma.customise_order.findMany({ where: { status: "scheduled", bargain_start_at: { lte: now }, expires_at: { gt: now } } });
    for (const order of due) {
      const moved = await prisma.customise_order.updateMany({ where: { id: order.id, status: "scheduled" }, data: { status: "open" } });
      if (moved && moved.count === 0) continue;
      await logEvent(prisma, order.id, "opened");
      await notifyEligible({ ...order, status: "open" }, { now });
      opened += 1;
    }
  } catch (err) {
    logger.error("customiseOrderService.activateDue failed:", err);
  }
  return opened;
}

/** Beep + count refresh for each online eligible driver, once per (order, driver) however often this is called. */
async function notifyEligible(order, { now = new Date() } = {}) {
  try {
    if (!(await settings.isEnabled())) return 0;
    const where = { status: 1, a_status: 1 };
    if (order.city_id != null) where.city_id = order.city_id;
    const [riders, categories] = await Promise.all([prisma.tbl_rider.findMany({ where }), categoriesByName()]);
    let sent = 0;
    for (const rider of riders) {
      if (!rules.driverEligible({ order, rider, category: categoryOf(categories, rider.vehicle), dismissed: false })) continue;
      if (await prisma.customise_event.findFirst({ where: { order_id: order.id, rider_id: rider.id, type: "notified" } })) continue;
      await logEvent(prisma, order.id, "notified", rider.id);
      dispatchManager.emitDriverEvent(rider.id, "customise:new", { order_id: order.id, fare: num(order.initial_fare) });
      if (rider.fcm_token) await pushNotifier.notifyDriverCustomiseOrder(rider.fcm_token, { orderId: order.id, fare: num(order.initial_fare) }).catch(() => {});
      sent += 1;
    }
    return sent;
  } catch (err) {
    logger.error("customiseOrderService.notifyEligible failed:", err);
    return 0;
  }
}

module.exports = {
  createOrder, listOpenForDriver, driverAccept, driverCounter, driverDismiss,
  myOrders, getOrder, listOffers, customerAcceptOffer, customerRejectOffer, customerCancel,
  expireDue, activateDue, notifyEligible, logEvent,
};
