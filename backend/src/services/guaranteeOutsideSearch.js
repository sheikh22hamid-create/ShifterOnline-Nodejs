const prisma = require("../config/db");
const logger = require("../utils/logger");
const adminSocket = require("../sockets/adminSocket");
const queueSettings = require("./guaranteeQueueSettings");
const candidates = require("./guaranteeOutsideCandidateService");
const outsideDriver = require("./outsideDriverService");

// Automatic outside-driver search for a held Booking Guarantee case (spec 2026-10-20): lookup -> register a Trial
// driver -> store the candidate -> hand the case to a free executive. One worker per case, guarded by a DB lease.
const LEASE_MS = 3 * 60 * 1000;
const GAP_MS = 10 * 1000;
const MAX_ITERATIONS = 40; // hard stop for a loop that never reaches a lookup limit (e.g. endless busy/repeat answers)
const SWEEP_BATCH = 50;

// Lazy: guaranteeQueueService requires this module, so a top-level require would be a cycle.
const queue = () => require("./guaranteeQueueService");
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function audit(caseRow, event, meta = null) {
  try {
    await prisma.booking_guarantee_audit.create({
      data: { case_id: caseRow.id, order_id: caseRow.order_id, event, admin_id: null, meta: meta ? JSON.stringify(meta) : null },
    });
  } catch (err) {
    logger.error(`guaranteeOutsideSearch: audit ${event} failed for case ${caseRow?.id}:`, err);
  }
}

/** Compare-and-swap on a free or expired lease: exactly one worker per case, across app instances. */
async function acquireLease(caseId, now = new Date()) {
  const res = await prisma.booking_guarantee_case.updateMany({
    where: { id: caseId, status: "open", OR: [{ search_lease_until: null }, { search_lease_until: { lt: now } }] },
    data: { search_state: "searching", search_lease_until: new Date(now.getTime() + LEASE_MS) },
  });
  return res.count === 1;
}

const renewLease = (caseId) =>
  prisma.booking_guarantee_case.updateMany({ where: { id: caseId, status: "open" }, data: { search_lease_until: new Date(Date.now() + LEASE_MS) } });

/** Free the lease; `state` is the search_state to leave behind (null = idle). */
const releaseLease = (caseId, state = null) =>
  prisma.booking_guarantee_case.updateMany({ where: { id: caseId }, data: { search_lease_until: null, search_state: state } });

async function exhaust(caseRow, reason) {
  await releaseLease(caseRow.id, "exhausted");
  await audit(caseRow, "outside_search_exhausted", { reason });
  try {
    adminSocket.notifyDispatchAlert(
      caseRow.order_id, caseRow.city_id,
      `No outside driver found for Booking Guarantee order #${caseRow.order_id}. Search limit reached`,
      { kind: "outside_search_exhausted", reason },
    );
  } catch (err) {
    logger.error(`guaranteeOutsideSearch: exhaustion alert failed for order ${caseRow.order_id}:`, err);
  }
}

// What a lookup error means for the loop.
function classify(err) {
  const status = err && err.statusCode;
  const message = String((err && err.message) || "");
  if (status === 429 && /limit reached/i.test(message)) return { action: "exhausted", reason: "lookup_limit" };
  if (status === 429) return { action: "retry" }; // gap not elapsed, or a lookup for this order already running
  if (status === 409) return { action: "stopped" }; // order no longer held
  if (status === 400 || status === 422 || status === 404) return { action: "exhausted", reason: message.slice(0, 80) || "unsupported" };
  return { action: "retry" }; // transient (the partner service itself never throws here)
}

/**
 * Run the search for one case. Outcome: candidate (a live Trial Driver is stored), exhausted (limit reached),
 * stopped (case closed / order taken / switch off), busy (another worker holds the lease).
 * `deps` ({ sleep, lookupFn, registerFn }) exist for tests.
 */
async function runSearch(caseId, deps = {}) {
  const sleep = deps.sleep || defaultSleep;
  const lookupFn = deps.lookupFn || outsideDriver.lookup;
  const registerFn = deps.registerFn || outsideDriver.registerTrial;

  if (!(await acquireLease(caseId))) return { outcome: "busy" };
  let caseRow = await prisma.booking_guarantee_case.findUnique({ where: { id: caseId } });
  if (caseRow) await audit(caseRow, "outside_search_started");
  try {
    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      caseRow = await prisma.booking_guarantee_case.findUnique({ where: { id: caseId } });
      if (!caseRow || caseRow.status !== "open" || !(await queueSettings.autoSearchActive(caseRow.city_id))) {
        await releaseLease(caseId);
        return { outcome: "stopped" };
      }
      if (await candidates.getLive(caseId)) {
        await releaseLease(caseId);
        return { outcome: "candidate" };
      }
      const order = await prisma.pkg_order.findUnique({
        where: { id: caseRow.order_id }, select: { id: true, rid: true, order_status: true, o_status: true, category: true },
      });
      if (!order || order.rid !== 0 || order.order_status !== 0 || order.o_status !== "Pending") {
        await releaseLease(caseId);
        return { outcome: "stopped" };
      }
      await renewLease(caseId);

      let result;
      try {
        result = await lookupFn({ orderId: caseRow.order_id, vehicleId: outsideDriver.guessVehicleId(order.category), adminId: null });
      } catch (err) {
        const verdict = classify(err);
        if (verdict.action === "exhausted") { await exhaust(caseRow, verdict.reason); return { outcome: "exhausted" }; }
        if (verdict.action === "stopped") { await releaseLease(caseId); return { outcome: "stopped" }; }
        await sleep(GAP_MS);
        continue;
      }

      const driver = result && result.driver;
      if (driver && !result.repeat && !(await candidates.hasOffered(caseId, { mobile: driver.mobile, vehicleNumber: driver.vehicle_number }))) {
        await audit(caseRow, "outside_driver_found", { mobile: driver.mobile, vehicle_number: driver.vehicle_number });
        let trial = null;
        try {
          trial = await registerFn({
            orderId: caseRow.order_id, name: driver.name, mobile: driver.mobile, vehicleNumber: driver.vehicle_number, trialOrders: 1, adminId: null,
          });
        } catch (err) {
          logger.error(`guaranteeOutsideSearch: trial registration failed for order ${caseRow.order_id}:`, err);
          await audit(caseRow, "outside_trial_failed", { mobile: driver.mobile, error: String(err.message || err).slice(0, 120) });
        }
        if (trial) {
          const stored = await candidates.createLive({ caseId, orderId: caseRow.order_id, riderId: trial.rider_id, driver });
          if (stored.created) {
            await audit(caseRow, "outside_trial_created", { rider_id: trial.rider_id, kind: trial.kind });
            await releaseLease(caseId);
            try {
              await queue().dispatchWaiting(caseRow.city_id);
            } catch (err) {
              logger.error(`guaranteeOutsideSearch: dispatchWaiting failed for city ${caseRow.city_id}:`, err);
            }
            return { outcome: "candidate" };
          }
        }
      }
      await sleep(GAP_MS);
    }
    await exhaust(caseRow, "max_iterations");
    return { outcome: "exhausted" };
  } catch (err) {
    logger.error(`guaranteeOutsideSearch: search for case ${caseId} crashed:`, err);
    try { await releaseLease(caseId); } catch (_) { /* the lease expires by itself */ }
    return { outcome: "stopped" };
  }
}

/** Fire-and-forget: never throws, never blocks the caller (the lookup can take over a minute). */
function startForCase(caseId) {
  runSearch(caseId).catch((err) => logger.error(`guaranteeOutsideSearch: worker for case ${caseId} failed:`, err));
}

/** Sweeper pass: (re)start workers for open auto-mode cases that have no live candidate and no live worker. */
async function sweep(now = new Date(), start = startForCase) {
  const rows = await prisma.booking_guarantee_case.findMany({
    where: {
      status: "open", queue_state: { not: null }, city_id: { not: null }, deadline_at: { gt: now },
      AND: [
        { OR: [{ search_state: null }, { search_state: "searching" }] },
        { OR: [{ search_lease_until: null }, { search_lease_until: { lt: now } }] },
      ],
    },
    orderBy: { deadline_at: "asc" }, take: SWEEP_BATCH,
  });
  let started = 0;
  for (const c of rows) {
    try {
      if (!(await queueSettings.autoSearchActive(c.city_id))) continue;
      if (await candidates.getLive(c.id)) continue;
      start(c.id);
      started += 1;
    } catch (err) {
      logger.error(`guaranteeOutsideSearch: sweep skipped case ${c.id}:`, err);
    }
  }
  return started;
}

module.exports = { acquireLease, runSearch, startForCase, sweep };
