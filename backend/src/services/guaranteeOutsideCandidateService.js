const prisma = require("../config/db");

// Store for the outside (Trial) driver offered to an executive for a held guarantee case (spec 2026-10-20).
// `active` is 1 for the live candidate and null afterwards (never 0): UNIQUE(case_id, active) allows one live
// candidate per case, UNIQUE(case_id, mobile) stops the same driver being offered twice for an order.
const model = () => prisma.guarantee_outside_candidate;
const normPlate = (v) => String(v ?? "").trim().toUpperCase();

/** Insert the live candidate. created:false when one is already live or this driver was already offered. */
async function createLive({ caseId, orderId, riderId, driver }) {
  try {
    const row = await model().create({
      data: {
        case_id: caseId, order_id: orderId, rider_id: riderId,
        name: String(driver.name || "").slice(0, 120), mobile: String(driver.mobile),
        vehicle_number: normPlate(driver.vehicle_number).slice(0, 50), vehicle_name: String(driver.vehicle_name || "").slice(0, 120),
        fare: driver.fare ?? null, status: "ready", active: 1,
      },
    });
    return { created: true, row };
  } catch (err) {
    if (err && err.code === "P2002") return { created: false, row: null };
    throw err;
  }
}

const getLive = (caseId) => model().findFirst({ where: { case_id: caseId, active: 1 } });

/** Was this driver ever offered for the case (any status)? Matches by mobile or, when present, plate. */
async function hasOffered(caseId, { mobile, vehicleNumber }) {
  const or = [{ mobile: String(mobile) }];
  const plate = normPlate(vehicleNumber);
  if (plate) or.push({ vehicle_number: plate });
  return Boolean(await model().findFirst({ where: { case_id: caseId, OR: or }, select: { id: true } }));
}

/** Was this trial rider already offered for the case? Catches the same driver the partner reports with a differently formatted mobile. */
async function hasOfferedRider(caseId, riderId) {
  return Boolean(await model().findFirst({ where: { case_id: caseId, rider_id: riderId }, select: { id: true } }));
}

/** The executive rejects the live candidate. false when there is no ready live candidate. */
async function reject({ caseId, adminId, reason, client = prisma }) {
  const res = await client.guarantee_outside_candidate.updateMany({
    where: { case_id: caseId, active: 1, status: "ready" },
    data: {
      status: "rejected", active: null, rejected_by: adminId ?? null, rejected_at: new Date(),
      reject_reason: reason ? String(reason).slice(0, 200) : null,
    },
  });
  return res.count === 1;
}

async function markAssigned(caseId, riderId) {
  const res = await model().updateMany({ where: { case_id: caseId, rider_id: riderId, active: 1 }, data: { status: "assigned", active: null } });
  return res.count === 1;
}

/** The order closed (or was taken another way) while a candidate was live. */
async function supersedeLive(caseId, reason) {
  const res = await model().updateMany({
    where: { case_id: caseId, active: 1 }, data: { status: "superseded", active: null, reject_reason: reason ? String(reason).slice(0, 200) : null },
  });
  return res.count;
}

module.exports = { createLive, getLive, hasOffered, hasOfferedRider, reject, markAssigned, supersedeLive };
