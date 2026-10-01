// tbl_wallet_history.created_at (like tripLifecycle's ddate/drop_time) is a
// display-only column the apps and admin render as-is, so it is stored as IST
// wall-clock time (UTC + 5:30). Every writer must use this same convention,
// otherwise the ledger shows rows from different writers hours out of order.
function istNow() {
  return new Date(Date.now() + 330 * 60 * 1000);
}

module.exports = { istNow };
