// Booking Guarantee (spec 2026-10-07): pure rules, no I/O.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * The package whose configured amount applies = the highest sort_order among the
 * selected packages (sort_order is the tier priority, see orderController). Never
 * keyed on package id or model number, so a new Model 6/7 needs no change here.
 */
function computeGuaranteeCompensation(packages) {
  let top = null;
  for (const p of Array.isArray(packages) ? packages : []) {
    if (!p) continue;
    const order = Number(p.sort_order);
    const topOrder = top === null ? -Infinity : Number(top.sort_order);
    if (top === null || order > topOrder || (order === topOrder && Number(p.id) > Number(top.id))) top = p;
  }
  if (!top) return { packageId: null, amount: 0 };
  const raw = Number(top.no_driver_compensation);
  const amount = Number.isFinite(raw) && raw > 0 ? round2(raw) : 0;
  return { packageId: top.id, amount };
}

/** What the customer app is told: none | pending | paid | not_paid. */
function guaranteeStateFor(row) {
  if (!row) return "none";
  if (row.status === "open") return "pending";
  if (row.status === "expired_compensated") return Number(row.compensation_amount) > 0 ? "paid" : "not_paid";
  return "none";
}

module.exports = { computeGuaranteeCompensation, guaranteeStateFor };
