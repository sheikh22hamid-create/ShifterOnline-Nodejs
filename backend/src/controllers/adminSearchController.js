const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function globalSearch(req, res) {
  try {
    const rawQuery = (req.query.q || req.query.search || "").trim();
    if (!rawQuery) {
      return res.status(200).json({
        success: true,
        results: { orders: [], drivers: [], customers: [] },
      });
    }

    const cleanNum = rawQuery.replace(/^[#\s]+/, "");
    const isNumeric = /^\d+$/.test(cleanNum);
    const numVal = isNumeric ? parseInt(cleanNum, 10) : null;
    const scopedCityId = req.scopedCityId;

    // 1. Search Customers (tbl_user)
    const userWhere = {};
    if (scopedCityId) userWhere.city_id = scopedCityId;
    const userOr = [
      { name: { contains: rawQuery } },
      { email: { contains: rawQuery } },
    ];
    if (isNumeric) {
      userOr.push({ id: numVal });
      userOr.push({ mobile: Number(cleanNum) });
    }
    userWhere.OR = userOr;

    const customersPromise = prisma.tbl_user.findMany({
      where: userWhere,
      take: 8,
      orderBy: { id: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        city_id: true,
        wallet: true,
        plan_type: true,
        status: true,
        rdate: true,
      },
    });

    // 2. Search Drivers (tbl_rider)
    const riderWhere = {};
    if (scopedCityId) riderWhere.city_id = scopedCityId;
    const riderOr = [
      { full_name: { contains: rawQuery } },
      { first_name: { contains: rawQuery } },
      { last_name: { contains: rawQuery } },
      { fmobile: { contains: rawQuery } },
      { email: { contains: rawQuery } },
      { vehicle_no: { contains: rawQuery } },
    ];
    if (isNumeric) {
      riderOr.push({ id: numVal });
    }
    riderWhere.OR = riderOr;

    const driversPromise = prisma.tbl_rider.findMany({
      where: riderWhere,
      take: 8,
      orderBy: { id: "desc" },
      select: {
        id: true,
        full_name: true,
        first_name: true,
        last_name: true,
        fmobile: true,
        email: true,
        vehicle_no: true,
        city_id: true,
        status: true,
        a_status: true,
        verification_status: true,
        r_type: true,
      },
    });

    // Execute customer & rider searches first so we can find orders by their IDs too
    const [customers, drivers] = await Promise.all([customersPromise, driversPromise]);

    const matchingCustomerIds = customers.map((c) => c.id);
    const matchingDriverIds = drivers.map((d) => d.id);

    // 3. Search Orders (pkg_order)
    const orderWhere = {};
    if (scopedCityId) orderWhere.city_id = scopedCityId;
    const orderOr = [
      { trans_id: { contains: rawQuery } },
      { p_method_name: { contains: rawQuery } },
      { pickup_address: { contains: rawQuery } },
      { drop_address: { contains: rawQuery } },
    ];
    if (isNumeric) {
      orderOr.push({ id: numVal });
    }
    if (matchingCustomerIds.length > 0) {
      orderOr.push({ uid: { in: matchingCustomerIds } });
    }
    if (matchingDriverIds.length > 0) {
      orderOr.push({ rid: { in: matchingDriverIds } });
    }
    orderWhere.OR = orderOr;

    const orders = await prisma.pkg_order.findMany({
      where: orderWhere,
      take: 8,
      orderBy: { id: "desc" },
      select: {
        id: true,
        uid: true,
        rid: true,
        o_status: true,
        odate: true,
        total_dcharge: true,
        p_method_name: true,
        city_id: true,
        pickup_address: true,
        drop_address: true,
        v_type: true,
      },
    });

    // Resolve city names for all results
    const allCityIds = [
      ...new Set([
        ...customers.map((c) => c.city_id),
        ...drivers.map((d) => d.city_id),
        ...orders.map((o) => o.city_id),
      ].filter(Boolean)),
    ];

    let cityMap = {};
    if (allCityIds.length > 0) {
      const cities = await prisma.tbl_city.findMany({
        where: { id: { in: allCityIds } },
        select: { id: true, title: true },
      });
      cityMap = Object.fromEntries(cities.map((c) => [c.id, c.title]));
    }

    // Resolve order user and rider info
    const orderUids = [...new Set(orders.map((o) => o.uid).filter(Boolean))];
    const orderRids = [...new Set(orders.map((o) => o.rid).filter(Boolean))];

    const [orderUsers, orderRiders] = await Promise.all([
      orderUids.length
        ? prisma.tbl_user.findMany({
            where: { id: { in: orderUids } },
            select: { id: true, name: true, mobile: true },
          })
        : [],
      orderRids.length
        ? prisma.tbl_rider.findMany({
            where: { id: { in: orderRids } },
            select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, vehicle_no: true },
          })
        : [],
    ]);

    const userMap = Object.fromEntries(orderUsers.map((u) => [u.id, u]));
    const riderMap = Object.fromEntries(
      orderRiders.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`,
          mobile: r.fmobile,
          vehicle_no: r.vehicle_no,
        },
      ])
    );

    const formattedOrders = orders.map((o) => {
      const u = userMap[o.uid];
      const r = riderMap[o.rid];
      return {
        id: o.id,
        status: o.o_status,
        date: o.odate,
        total_fare: o.total_dcharge,
        payment_method: o.p_method_name,
        city_id: o.city_id,
        city_name: cityMap[o.city_id] || null,
        pickup_address: o.pickup_address,
        drop_address: o.drop_address,
        vehicle_type: o.v_type,
        customer: u ? { id: u.id, name: u.name, mobile: String(u.mobile) } : null,
        driver: r || null,
      };
    });

    const formattedDrivers = drivers.map((d) => ({
      id: d.id,
      name: d.full_name || `${d.first_name || ""} ${d.last_name || ""}`.trim() || `Driver #${d.id}`,
      email: d.email,
      mobile: d.fmobile,
      vehicle_no: d.vehicle_no,
      city_id: d.city_id,
      city_name: cityMap[d.city_id] || null,
      status: d.status,
      online: d.a_status === 1,
      approval_status: d.verification_status,
      type: d.r_type,
    }));

    const formattedCustomers = customers.map((c) => ({
      id: c.id,
      name: c.name || `Customer #${c.id}`,
      email: c.email,
      mobile: String(c.mobile || ""),
      city_id: c.city_id,
      city_name: cityMap[c.city_id] || null,
      wallet: c.wallet,
      plan_type: c.plan_type,
      status: c.status,
    }));

    return res.status(200).json({
      success: true,
      query: rawQuery,
      results: {
        orders: formattedOrders,
        drivers: formattedDrivers,
        customers: formattedCustomers,
      },
    });
  } catch (err) {
    return internalError(res, err, "adminSearch.globalSearch");
  }
}

module.exports = {
  globalSearch,
};
