const prisma = require("../config/db");

// Called once per completed order (from tripLifecycle.js). A no-op for any
// rider not currently in an active trial - trial and KYC verification are
// independent axes, see driverApproval.js for the KYC side.
async function recordTrialOrderCompletion(riderId) {
  const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
  if (!rider || rider.trial_status !== "active") return;

  const completed = rider.trial_orders_completed + 1;
  const exhausted = rider.trial_orders_allowed != null && completed >= rider.trial_orders_allowed;

  await prisma.tbl_rider.update({
    where: { id: riderId },
    data: {
      trial_orders_completed: completed,
      trial_status: exhausted ? "exhausted" : "active",
      a_status: exhausted ? 0 : rider.a_status,
    },
  });
}

module.exports = { recordTrialOrderCompletion };
