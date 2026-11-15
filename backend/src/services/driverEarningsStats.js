const prisma = require("../config/db");

// Completed-order count and earning for a driver's Home "Today's Earning" / month box.
//
// Only a Completed order counts. pkg_order marks completion with o_status 'Completed' (order_status 5); a cancelled
// order has o_status 'Cancelled' and order_status 4. buy_order completes with o_status 'Completed' (flow_id 10);
// flow_id 4 is a CANCEL there and flow_id 5 is an order still in progress. These used to be counted as completed
// (`order_status = 4 OR order_status = 5`, `flow_id = 4 OR flow_id = 5`), which put cancelled rides into the completed
// count and their earning into the total.
//
// The earning formulas are unchanged: they only ever see Completed orders now.

async function pkgStats(rid, from, to) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total_order,
      IFNULL(ROUND(SUM(
        CASE
          WHEN COALESCE(driver_earning, 0) > 0 THEN driver_earning
          WHEN COALESCE(total_dcharge, 0) > 0 THEN (total_dcharge - (total_dcharge * COALESCE(commission, 0) / 100))
          ELSE (COALESCE(d_charge, 0) - (COALESCE(d_charge, 0) * COALESCE(commission, 0) / 100)) + COALESCE(extra_mile_charge, 0)
        END
      ), 2), 0) AS earning
    FROM pkg_order
    WHERE rid = ${rid}
      AND (LOWER(TRIM(o_status)) = 'completed' OR order_status = 5)
      AND LOWER(TRIM(o_status)) NOT IN ('cancelled', 'cancel')
      AND COALESCE(order_status, 0) <> 4
      AND COALESCE(ddate, odate) BETWEEN ${from} AND ${to}
  `;
  return rows[0] || { total_order: 0, earning: 0 };
}

async function buyStats(rid, from, to) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total_order,
      IFNULL(ROUND(SUM(
        (COALESCE(d_charge, 0) - (COALESCE(d_charge, 0) * COALESCE(commission, 0) / 100)) + COALESCE(extra_mile_charge, 0) + COALESCE(item_total, 0)
      ), 2), 0) AS earning
    FROM buy_order
    WHERE rid = ${rid}
      AND LOWER(TRIM(o_status)) = 'completed'
      AND order_date BETWEEN ${from} AND ${to}
  `;
  return rows[0] || { total_order: 0, earning: 0 };
}

module.exports = { pkgStats, buyStats };
