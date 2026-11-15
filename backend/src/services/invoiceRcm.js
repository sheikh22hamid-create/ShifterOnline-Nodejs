// RCM summary shown at the bottom of a completed ride's invoice (spec 2026-11-15). DISPLAY ONLY.
//
//   RCM amount = final total fare x 5 / 100
//
// It is never collected, never added to the payable fare or the final total, and never stored: no transaction, wallet entry,
// ledger row or admin record exists for it. This module has no I/O on purpose, so it cannot persist anything.

const RCM_RATE_PERCENT = 5;
const COMPLETED = new Set(["completed", "delivered"]);

/** { finalTotalFare, ratePercent, amount } for a completed ride with a fare, else null (no section is shown). */
function rcmSummary(fareTotal, status) {
  if (!COMPLETED.has(String(status || "").trim().toLowerCase())) return null;
  const fare = Number(fareTotal);
  if (!Number.isFinite(fare) || fare <= 0) return null;
  const paise = Math.round(fare * 100); // whole paise first, so 0.1 + 0.2 style float noise cannot move the result
  const amount = Math.round((paise * RCM_RATE_PERCENT) / 100) / 100;
  return { finalTotalFare: paise / 100, ratePercent: RCM_RATE_PERCENT, amount };
}

module.exports = { rcmSummary, RCM_RATE_PERCENT };
