// order_status: 0 unassigned, 1 accepted ("Processing"), 2 arrived at
// pickup ("Pickup" — driver is there but hasn't collected the package yet),
// 3 picked up / en route ("On_Route"), 5 completed.
//
// Phase 1 (heading to pickup) covers BOTH 1 and 2 — o_status "Pickup" means
// "arrived, waiting/verifying OTP", not "collected". Only order_status 3
// means the package has actually left the pickup point, which is when the
// route should switch to the single drop-off leg.
export function getTripPhase(order) {
  if (!order) return null
  if (order.order_status === 1 || order.order_status === 2) return 1
  if (order.order_status === 3) return 2
  return null
}
