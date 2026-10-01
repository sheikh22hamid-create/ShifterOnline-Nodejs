// tbl_wallet_history.created_at (like tripLifecycle's ddate/drop_time) is a
// display-only column the apps and admin render as-is, so it is stored as IST
// wall-clock time (UTC + 5:30). Every writer must use this same convention,
// otherwise the ledger shows rows from different writers hours out of order.
function istNow() {
  return new Date(Date.now() + 330 * 60 * 1000);
}

// Serializes a stored ledger timestamp as a plain "yyyy-MM-dd HH:mm:ss" wall
// clock string. The column holds IST wall-clock labelled as UTC, so a JSON
// Date ("...Z") makes every client that converts to local time (admin panel's
// browser) shift it by +5:30, and the driver app's yyyy-MM-dd HH:mm:ss parser
// can't read the ISO form at all. A zone-less string renders as-is everywhere.
function formatLedgerTime(value) {
  if (!value) return value ?? null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

module.exports = { istNow, formatLedgerTime };
