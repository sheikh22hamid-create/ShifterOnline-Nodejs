// Customer-facing view of an order's billable waiting, built from the same
// data tripLifecycle's "complete" handler bills from (see updateStatus):
//   billable wait = pickup_load_wait_seconds (OTP -> Pickup Complete)
//                 + time since drop_wait_start (drop arrival -> completion)
// The arrival -> OTP wait (pickup_wait_seconds) is never billed.
// The app runs the live clock itself from `running_since` + `server_time`.

const round2 = (n) => Math.round(n * 100) / 100;
const toMs = (d) => (d ? new Date(d).getTime() : 0);

function buildCustomerWaitingView(order, timer, nowMs = Date.now()) {
  const freeMinutes = parseFloat(order.free_waiting_time) || 0;
  const ratePerMinute = Number(order.wating_charge) || 0;
  const completed = Number(order.order_status) === 5;

  let bankedSeconds = Number(timer?.pickup_load_wait_seconds) || 0;
  let runningSince = 0;
  let phase = null;
  if (!completed && timer) {
    if (Number(order.order_status) === 2 && timer.pickup_load_wait_start) {
      runningSince = toMs(timer.pickup_load_wait_start);
      phase = "loading";
    } else if (Number(order.order_status) === 3 && timer.drop_wait_start && !timer.drop_wait_end) {
      runningSince = toMs(timer.drop_wait_start);
      phase = "unloading";
    }
  }
  if (completed) bankedSeconds = Number(timer?.total_wait_seconds) || 0;

  // Billed amount only exists once the trip is completed (complete adds it
  // onto total_dcharge, leaving d_charge as the pre-waiting fare).
  const billed = completed
    ? Math.max(0, round2((Number(order.total_dcharge) || 0) - (Number(order.d_charge) || 0)))
    : 0;

  return {
    enabled: freeMinutes > 0 || ratePerMinute > 0,
    free_waiting_time_minutes: freeMinutes,
    waiting_charge_per_minute: ratePerMinute,
    billable_seconds_banked: bankedSeconds,
    running_since: runningSince,
    phase,
    waiting_charge_billed: billed,
    server_time: nowMs,
  };
}

module.exports = { buildCustomerWaitingView };
