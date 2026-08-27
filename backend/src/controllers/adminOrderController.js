const prisma = require("../config/db");
const logger = require("../utils/logger");
const dispatchManager = require("../services/dispatchManager");
const pricingEngine = require("../services/pricingEngine");
const adminSocket = require("../sockets/adminSocket");
const { getIO } = require("../sockets/socketServer");

const STATUS_MAP = {
  pending: "Pending",
  processing: "Processing",
  pickup: "Pickup",
  on_route: "On_Route",
  completed: "Completed",
  cancelled: "Cancelled",
};

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function isScopedOut(req, orderCityId) {
  return req.user.role !== "superadmin" && orderCityId !== parseInt(req.user.city_id, 10);
}

async function list(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;

    if (req.query.status) {
      const mapped = STATUS_MAP[req.query.status];
      if (!mapped) {
        return res.status(400).json({ success: false, message: `status must be one of ${Object.keys(STATUS_MAP).join(", ")}` });
      }
      where.o_status = mapped;
    }

    if (req.query.date) {
      const start = new Date(`${req.query.date}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.odate = { gte: start, lt: end };
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const [total, rows] = await Promise.all([
      prisma.pkg_order.count({ where }),
      prisma.pkg_order.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * limit, take: limit }),
    ]);

    const uids = [...new Set(rows.map((o) => o.uid))];
    const rids = [...new Set(rows.map((o) => o.rid).filter((rid) => rid))];
    const [customers, riders] = await Promise.all([
      prisma.tbl_user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, mobile: true } }),
      prisma.tbl_rider.findMany({ where: { id: { in: rids } }, select: { id: true, first_name: true, last_name: true, full_name: true, fmobile: true } }),
    ]);
    const customerById = Object.fromEntries(customers.map((c) => [c.id, c]));
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const data = rows.map((o) => {
      const customer = customerById[o.uid];
      const rider = o.rid ? riderById[o.rid] : null;
      return {
        id: o.id,
        uid: o.uid,
        customer_name: customer ? customer.name : null,
        customer_mobile: customer ? String(customer.mobile) : null,
        rid: o.rid,
        rider_name: rider ? rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "Unassigned",
        o_status: o.o_status,
        order_status: o.order_status,
        total_dcharge: String(o.total_dcharge),
        paddress: o.paddress,
        daddress: o.daddress,
        odate: o.odate,
        city_id: o.city_id,
      };
    });

    return res.status(200).json({ success: true, total, page, limit, data });
  } catch (err) {
    return internalError(res, err, "orders.list");
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await prisma.pkg_order.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (isScopedOut(req, order.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
    }

    const [customer, rider, waitTimer, pkg, paymentMethod] = await Promise.all([
      prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { id: true, name: true, mobile: true, email: true } }),
      order.rid ? prisma.tbl_rider.findUnique({ where: { id: order.rid } }) : null,
      prisma.pkg_order_wait_timer.findFirst({ where: { order_id: id }, orderBy: { id: "desc" } }),
      order.delivery_type ? prisma.tbl_package.findUnique({ where: { id: order.delivery_type } }) : null,
      order.p_method_id ? prisma.tbl_payment_list.findUnique({ where: { id: order.p_method_id }, select: { title: true } }) : null,
    ]);

    return res.status(200).json({
      success: true,
      data: {
        ...order,
        customer,
        rider: rider
          ? {
              id: rider.id,
              name: rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
              mobile: rider.fmobile,
              vehicle_no: rider.vehicle_no,
              rlats: rider.rlats,
              rlongs: rider.rlongs,
            }
          : null,
        wait_timer: waitTimer,
        package: pkg,
        payment_method: paymentMethod ? paymentMethod.title : null,
      },
    });
  } catch (err) {
    return internalError(res, err, "orders.getOne");
  }
}

async function assignRider(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    const riderId = parseInt(req.body.rider_id, 10);
    if (!riderId) {
      return res.status(400).json({ success: false, message: "rider_id is required" });
    }

    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (isScopedOut(req, order.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
    }
    if (order.rid !== 0 || order.order_status !== 0) {
      return res.status(409).json({ success: false, message: "Order is already assigned, completed, or cancelled" });
    }
    if (!order.delivery_type) {
      return res.status(400).json({ success: false, message: "Order has no rate card assigned yet — cannot compute fare" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }
    if (rider.status !== 1) {
      return res.status(400).json({ success: false, message: "Driver is not approved" });
    }
    if (rider.a_status !== 1) {
      return res.status(400).json({ success: false, message: "Driver is currently offline" });
    }
    // order_status alone isn't reliable — cancel() (here and in tripLifecycle)
    // only ever updates o_status, never resets order_status, so a cancelled
    // order can still show order_status 1-3 forever. o_status is the
    // authoritative terminal-state signal.
    const riderBusy = await prisma.pkg_order.count({
      where: { rid: riderId, order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
    });
    if (riderBusy) {
      return res.status(409).json({ success: false, message: "Driver already has an active trip" });
    }

    // Same atomic-conditional-UPDATE pattern as tripLifecycle.acceptOrder —
    // wins the race against the live dispatch cascade if it's still running.
    const affectedRows = await prisma.$executeRaw`
      UPDATE pkg_order
      SET rid = ${riderId}, order_status = 1, o_status = 'Processing', accept_time = NOW()
      WHERE id = ${orderId} AND rid = 0 AND order_status = 0 AND o_status != 'Cancelled'
    `;
    if (affectedRows === 0) {
      return res.status(409).json({ success: false, message: "Order was just taken or cancelled — refresh and retry" });
    }

    const { pkg, driverEarning, commission } = await pricingEngine.priceForPackageId(order.delivery_type, Number(order.distance) || 0);
    await prisma.pkg_order.update({ where: { id: orderId }, data: { driver_earning: driverEarning, commission } });

    dispatchManager.stopDispatch(orderId, "accepted_by_other");

    await prisma.order_status_history.create({
      data: { order_id: orderId, rider_id: riderId, status: "Processing", remark: `Manually assigned by admin #${req.user.id} (${req.user.username})` },
    });

    const updatedOrder = await prisma.pkg_order.findUnique({ where: { id: orderId } });

    try {
      const io = getIO();
      io.to(`driver_${riderId}`).emit("order:assigned", {
        order_id: updatedOrder.id,
        pickup_address: updatedOrder.paddress,
        delivery_address: updatedOrder.daddress,
        driver_earning: String(driverEarning),
      });
      io.to(`customer_${updatedOrder.uid}`).emit("order:assigned", {
        order_id: updatedOrder.id,
        rider_id: rider.id,
        rider_name: rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
        rider_phone: rider.fmobile,
        vehicle_no: rider.vehicle_no,
        order_status: updatedOrder.order_status,
        o_status: updatedOrder.o_status,
      });
    } catch (socketErr) {
      logger.error(`assignRider: socket notify failed for order ${orderId}:`, socketErr);
    }
    try {
      adminSocket.notifyOrderStatusUpdate(updatedOrder);
    } catch (adminErr) {
      logger.error(`assignRider: admin socket notify failed for order ${orderId}:`, adminErr);
    }

    return res.status(200).json({ success: true, message: "Driver assigned", data: { ...updatedOrder, package: pkg } });
  } catch (err) {
    return internalError(res, err, "orders.assignRider");
  }
}

const EDITABLE_FIELDS = ["paddress", "pmobile", "daddress", "dmobile", "description", "distance", "total_dcharge"];

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await prisma.pkg_order.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (isScopedOut(req, order.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
    }
    if (["Completed", "Cancelled"].includes(order.o_status)) {
      return res.status(409).json({ success: false, message: `Cannot edit a ${order.o_status.toLowerCase()} order` });
    }

    const data = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }
    if (data.distance !== undefined) data.distance = Number(data.distance);
    if (data.total_dcharge !== undefined) data.total_dcharge = Number(data.total_dcharge);

    const updated = await prisma.pkg_order.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Order updated", data: updated });
  } catch (err) {
    return internalError(res, err, "orders.update");
  }
}

async function cancel(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { comment, apply_cancellation_fee } = req.body;

    const order = await prisma.pkg_order.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (isScopedOut(req, order.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
    }
    if (["Completed", "Cancelled"].includes(order.o_status)) {
      return res.status(409).json({ success: false, message: `Order is already ${order.o_status.toLowerCase()}` });
    }

    const wasUnassigned = order.rid === 0 && order.order_status === 0;

    await prisma.pkg_order.update({
      where: { id },
      data: { o_status: "Cancelled", cancel_reason: comment || "Cancelled by admin" },
    });

    if (wasUnassigned) {
      dispatchManager.stopDispatch(id, "cancelled_by_user");
    } else if (apply_cancellation_fee && order.delivery_type) {
      const pkg = await pricingEngine.getPackageById(order.delivery_type);
      const fee = Number(pkg?.cancellation_charge_customer) || 0;
      if (fee > 0) {
        await prisma.tbl_wallet_history.create({
          data: {
            user_id: order.uid,
            amount: fee,
            type: "debit",
            remark: `Admin-cancelled order #${id}: ${comment || "no reason given"}`,
            wallet_type: "user",
            order_id: id,
            created_at: new Date(),
          },
        });
      }
    }

    await prisma.order_status_history.create({
      data: { order_id: id, rider_id: order.rid || null, status: "Cancelled", remark: `Cancelled by admin #${req.user.id}: ${comment || ""}` },
    });

    try {
      getIO().to(`order_${id}`).emit("order:cancelled", { order_id: id, reason: comment || "Cancelled by admin" });
    } catch (socketErr) {
      logger.error(`cancel: socket notify failed for order ${id}:`, socketErr);
    }
    try {
      adminSocket.notifyOrderStatusUpdate({ id, city_id: order.city_id, order_status: order.order_status, o_status: "Cancelled", rid: order.rid });
    } catch (adminErr) {
      logger.error(`cancel: admin socket notify failed for order ${id}:`, adminErr);
    }

    return res.status(200).json({ success: true, message: "Order cancelled" });
  } catch (err) {
    return internalError(res, err, "orders.cancel");
  }
}

async function invoice(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await prisma.pkg_order.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (isScopedOut(req, order.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
    }

    const [customer, rider] = await Promise.all([
      prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { name: true, email: true, mobile: true } }),
      order.rid ? prisma.tbl_rider.findUnique({ where: { id: order.rid }, select: { full_name: true, first_name: true, last_name: true } }) : null,
    ]);

    const lineItems = [
      { label: "Base delivery charge", amount: Number(order.d_charge) || 0 },
      { label: "Extra mile charge", amount: Number(order.extra_mile_charge) || 0 },
      { label: "Loading charge", amount: Number(order.loading_charge) || 0 },
      { label: "Unloading charge", amount: Number(order.unloading_charge) || 0 },
      { label: "Waiting charge", amount: Number(order.wating_charge) || 0 },
      { label: "Radius charge", amount: Number(order.radius_charge) || 0 },
      { label: "Coupon discount", amount: -(Number(order.cou_amt) || 0) },
    ].filter((item) => item.amount !== 0);

    return res.status(200).json({
      success: true,
      // No PDF renderer exists in this codebase — returning the itemized
      // breakdown as JSON rather than fabricating a download link.
      data: {
        order_id: order.id,
        invoice_date: order.ddate || order.odate,
        gst_number: order.gst_number,
        customer: customer ? { name: customer.name, email: customer.email, mobile: String(customer.mobile) } : null,
        driver: rider ? { name: rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim() } : null,
        pickup_address: order.paddress,
        delivery_address: order.daddress,
        distance_km: order.distance,
        line_items: lineItems,
        commission: order.commission,
        total: order.total_dcharge,
        payment_status: order.payment_status,
        pdf_url: null,
      },
    });
  } catch (err) {
    return internalError(res, err, "orders.invoice");
  }
}

// --- Scheduled / next-day bookings ------------------------------------------
// NOTE: no current order-creation path ever sets booking_type=2 (createOrder
// always defaults to 1/immediate and never writes schedule_date_time), so
// this list will legitimately be empty until that producer side exists.

async function listScheduled(req, res) {
  try {
    const where = { booking_type: 2 };
    if (req.scopedCityId) where.city_id = req.scopedCityId;
    if (req.query.date) where.schedule_date_time = { contains: req.query.date };
    if (req.query.status === "unassigned") where.rid = 0;
    if (req.query.status === "assigned") where.rid = { not: 0 };

    const rows = await prisma.pkg_order.findMany({ where, orderBy: { schedule_date_time: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "orders.listScheduled");
  }
}

async function assignScheduledDriver(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const riderId = parseInt(req.body.rider_id, 10);
    if (!riderId) {
      return res.status(400).json({ success: false, message: "rider_id is required" });
    }

    const order = await prisma.pkg_order.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (order.booking_type !== 2) {
      return res.status(400).json({ success: false, message: "This order is not a scheduled booking" });
    }
    if (isScopedOut(req, order.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    // Pre-binds the driver only — order_status/o_status stay as-is since the
    // trip hasn't started. There is no cron worker in this codebase yet to
    // wake the driver 30 minutes before pickup (spec §4.10.2); notify_driver_now
    // is the only notification path currently available.
    const updated = await prisma.pkg_order.update({ where: { id }, data: { rid: riderId } });

    if (req.body.notify_driver_now) {
      await prisma.tbl_rnoti.create({
        data: {
          rid: riderId,
          title: "Scheduled trip assigned",
          msg: `You've been pre-assigned to a scheduled pickup at ${order.paddress || "the listed address"}.`,
          type: "scheduled_order",
          date: new Date(),
        },
      });
      try {
        getIO().to(`driver_${riderId}`).emit("order:scheduled_assigned", { order_id: id, pickup_address: order.paddress });
      } catch (socketErr) {
        logger.error(`assignScheduledDriver: socket notify failed for order ${id}:`, socketErr);
      }
    }

    return res.status(200).json({ success: true, message: "Driver pre-assigned to scheduled order", data: updated });
  } catch (err) {
    return internalError(res, err, "orders.assignScheduledDriver");
  }
}

module.exports = { list, getOne, assignRider, update, cancel, invoice, listScheduled, assignScheduledDriver };
