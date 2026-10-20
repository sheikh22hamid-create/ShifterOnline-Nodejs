const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const adminSocket = require("../sockets/adminSocket");
const rules = require("./guaranteeQueueRules");
const queueSettings = require("./guaranteeQueueSettings");
const outsideCandidates = require("./guaranteeOutsideCandidateService");
const { BOOKING_GUARANTEE_SWEEP_INTERVAL_MS } = require("../config/constants");

const MIN_HANDOVER_MS = 2 * BOOKING_GUARANTEE_SWEEP_INTERVAL_MS;
const TICK_BATCH = 200;
const REPAIR_BATCH = 200;
const MAX_CLAIM_ATTEMPTS = 5;
const ALERT_THROTTLE_MS = 5 * 60 * 1000;
const TX_OPTIONS = { maxWait: 10000, timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
const END_REASON_FOR_STATUS = { resolved_assigned: "resolved", cancelled: "cancelled", expired_compensated: "expired" };

// Lazy: guaranteeOutsideSearch calls back into this module (dispatchWaiting), so a top-level require would be a cycle.
const outsideSearch = () => require("./guaranteeOutsideSearch");

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const safeJson = (v) => (v == null ? null : JSON.stringify(v));

async function writeAudit(client, caseId, orderId, event, { adminId = null, meta = null } = {}) {
  await client.booking_guarantee_audit.create({
    data: { case_id: caseId, order_id: orderId, event, admin_id: adminId, meta: safeJson(meta) },
  });
}

/** Socket alert (best-effort; never throws). Payload holds ids and codes only, no customer data. */
function notify(kind, caseRow, cityId, extra = {}) {
  const messages = {
    guarantee_assigned: `Booking Guarantee order #${caseRow.order_id} is assigned to you`,
    guarantee_reminder: `Reminder: Booking Guarantee order #${caseRow.order_id} window is running down`,
    guarantee_escalated: `ESCALATION: Booking Guarantee order #${caseRow.order_id} is close to its deadline`,
    guarantee_unassigned: `No executive available for Booking Guarantee order #${caseRow.order_id}`,
  };
  try {
    adminSocket.notifyDispatchAlert(caseRow.order_id, cityId, messages[kind] || kind, {
      kind, deadline_at: new Date(caseRow.deadline_at).toISOString(), owner_admin_id: caseRow.owner_admin_id ?? null, ...extra,
    });
  } catch (err) {
    logger.error(`guaranteeQueue: ${kind} notify failed for order ${caseRow.order_id}:`, err);
  }
}

async function ensureProfile(adminId) {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO executive_guarantee_profile (admin_id, available, updated_at)
    VALUES (${adminId}, 1, ${new Date()})
    ON DUPLICATE KEY UPDATE admin_id = admin_id`);
}

const isAutoMode = (city) => Boolean(city && city.execQueueEnabled && city.autoOutsideSearch);
// Auto mode (spec 2026-10-20): an executive holds ONE active case, whatever the profile or city capacity says.
const AUTO_CAPACITY = 1;
const rankFor = (candidates, city) =>
  isAutoMode(city)
    ? rules.rankCandidates(candidates.map((c) => ({ ...c, capacity: null })), AUTO_CAPACITY)
    : rules.rankCandidates(candidates, city.execDefaultCapacity);

/** Executives of a city with their live load: a COUNT of active periods on OPEN cases, never a stored counter. */
async function listCandidates(cityId, client = prisma) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT a.id AS admin_id, COALESCE(p.available, 1) AS available, p.capacity AS capacity, p.last_assigned_at AS last_assigned_at,
      (SELECT COUNT(*) FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id
        WHERE ga.admin_id = a.id AND ga.active = 1 AND c.status = 'open') AS load_count
    FROM admin a
    LEFT JOIN executive_guarantee_profile p ON p.admin_id = a.id
    WHERE a.role = 'executive' AND a.status = 1 AND a.city_id = ${Number(cityId)}`);
  return rows.map((r) => ({
    adminId: Number(r.admin_id), available: Number(r.available) === 1, capacity: r.capacity == null ? null : Number(r.capacity),
    load: Number(r.load_count), lastAssignedAt: r.last_assigned_at,
  }));
}

/**
 * Ends the active ownership period of a case (history row is kept; `active` goes NULL so the unique key
 * frees up). Returns how many periods were ended.
 */
async function endActiveAssignment(caseId, endReason, client = prisma, now = new Date()) {
  const res = await client.guarantee_assignment.updateMany({
    where: { case_id: caseId, active: 1 },
    data: { active: null, ended_at: now, end_reason: endReason },
  });
  return res.count;
}

/**
 * One short transaction that gives `caseId` to `adminId`, or a reason it could not. Concurrency:
 *  - the executive's profile row is locked FOR UPDATE, so every claim for that executive serialises (across
 *    all app instances: the lock lives in MySQL);
 *  - capacity correctness relies on (a) the per-executive profile row FOR UPDATE and (b) READ COMMITTED, so every
 *    statement after the lock sees all commits of earlier lock holders regardless of statement order;
 *  - the case is taken with a compare-and-swap on owner_admin_id (null for a first claim, the expected current
 *    owner for a reassignment), and UNIQUE(case_id, active) is a second independent guard.
 * deadline_at, status and compensation columns are never written here.
 */
async function tryAssign(caseId, adminId, { cityId, expectedOwnerId = null, source, assignedBy = null, endReason = "reassigned", reason = null, idleBefore }) {
  await ensureProfile(adminId);
  // Read BEFORE the transaction: it uses the global client (another pool connection) and must not run while the lock is held.
  const city = await queueSettings.getQueueSettings(cityId);
  try {
    return await prisma.$transaction(async (tx) => {
      const profile = (await tx.$queryRaw(Prisma.sql`
        SELECT admin_id, available, capacity FROM executive_guarantee_profile WHERE admin_id = ${adminId} FOR UPDATE`))[0];
      if (!profile || Number(profile.available) !== 1) return "candidate_unavailable";
      const admin = (await tx.$queryRaw(Prisma.sql`
        SELECT id FROM admin WHERE id = ${adminId} AND role = 'executive' AND status = 1 AND city_id = ${Number(cityId)}`))[0];
      if (!admin) return "candidate_unavailable";

      const capacity = isAutoMode(city)
        ? AUTO_CAPACITY
        : rules.effectiveCapacity({ capacity: profile.capacity == null ? null : Number(profile.capacity) }, city.execDefaultCapacity);
      const load = Number((await tx.$queryRaw(Prisma.sql`
        SELECT COUNT(*) AS load_count FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id
        WHERE ga.admin_id = ${adminId} AND ga.active = 1 AND c.status = 'open'`))[0].load_count);
      if (load >= capacity) return "at_capacity";

      const now = new Date();
      const swapped = await tx.booking_guarantee_case.updateMany({
        where: {
          id: caseId, status: "open", city_id: Number(cityId), owner_admin_id: expectedOwnerId,
          // idle handover only: the owner must STILL be idle at swap time (an action recorded since the decision wins)
          ...(idleBefore instanceof Date ? { OR: [{ last_action_at: null }, { last_action_at: { lt: idleBefore } }] } : {}),
        },
        data: { owner_admin_id: adminId, owner_assigned_at: now, queue_state: "assigned", unassigned_reason: null },
      });
      if (swapped.count === 0) return "case_gone";
      // an already-escalated case stays escalated for the new owner (the idle clock fields are untouched)
      await tx.booking_guarantee_case.updateMany({
        where: { id: caseId, owner_admin_id: adminId, escalated_at: { not: null } }, data: { queue_state: "escalated" },
      });

      if (expectedOwnerId !== null) await endActiveAssignment(caseId, endReason, tx, now);
      await tx.guarantee_assignment.create({
        data: { case_id: caseId, admin_id: adminId, assigned_by: assignedBy, source, started_at: now, active: 1, reassign_reason: reason },
      });
      await tx.$executeRaw(Prisma.sql`UPDATE executive_guarantee_profile SET last_assigned_at = ${now} WHERE admin_id = ${adminId}`);
      const row = await tx.booking_guarantee_case.findUnique({ where: { id: caseId }, select: { order_id: true } });
      const event = expectedOwnerId !== null ? "exec_reassigned" : source === "auto" ? "exec_auto_assigned" : "exec_manually_assigned";
      await writeAudit(tx, caseId, row.order_id, event, {
        adminId: assignedBy, meta: { executive: adminId, from: expectedOwnerId, source, reason, load, capacity },
      });
      return "claimed";
    }, TX_OPTIONS);
  } catch (err) {
    if (err && err.code === "P2002") return "case_gone"; // a second active period for this case: someone else won
    if (err && (err.code === "P2034" || err.code === "P2028" || /deadlock|lock wait timeout/i.test(String(err.message)))) return "candidate_busy";
    throw err;
  }
}

/** No executive could take the case: keep it visible as unassigned and alert supervisors (throttled). */
async function markUnassigned(caseRow, cityId, reason) {
  await prisma.booking_guarantee_case.updateMany({
    where: { id: caseRow.id, status: "open", owner_admin_id: null },
    data: { queue_state: "unassigned", unassigned_reason: reason },
  });
  const cutoff = new Date(Date.now() - ALERT_THROTTLE_MS);
  const throttled = await prisma.booking_guarantee_case.updateMany({
    where: { id: caseRow.id, status: "open", owner_admin_id: null, OR: [{ last_alerted_at: null }, { last_alerted_at: { lt: cutoff } }] },
    data: { last_alerted_at: new Date() },
  });
  if (throttled.count !== 1) return;
  await writeAudit(prisma, caseRow.id, caseRow.order_id, "exec_no_executive_alert", { meta: { reason } });
  notify("guarantee_unassigned", { ...caseRow, owner_admin_id: null }, cityId, { reason });
}

/**
 * Automatic assignment of an unowned open case. Tries the ranked executives (max MAX_CLAIM_ATTEMPTS); a lost
 * race moves on to the next one. If nobody can take it the case stays/returns to the unassigned queue with a reason.
 */
async function claimCase(caseId, { cityId, source = "auto", assignedBy = null } = {}) {
  const row = await prisma.booking_guarantee_case.findUnique({ where: { id: caseId } });
  if (!row || row.status !== "open" || row.owner_admin_id || Number(row.city_id) !== Number(cityId)) return { claimed: false, reason: "not_claimable" };

  const city = await queueSettings.getQueueSettings(cityId);
  // Auto mode: only a case that already has a ready Trial Driver is handed out; one still searching is not "unassigned".
  if (isAutoMode(city) && !(await outsideCandidates.getLive(caseId))) return { claimed: false, reason: "awaiting_driver" };
  const candidates = await listCandidates(cityId);
  const ranked = rankFor(candidates, city);
  if (!ranked.length) {
    const reason = rules.unassignedReason(candidates);
    await markUnassigned(row, cityId, reason);
    return { claimed: false, reason };
  }
  for (const cand of ranked.slice(0, MAX_CLAIM_ATTEMPTS)) {
    const outcome = await tryAssign(caseId, cand.adminId, { cityId, expectedOwnerId: null, source, assignedBy });
    if (outcome === "claimed") {
      notify("guarantee_assigned", { ...row, owner_admin_id: cand.adminId }, cityId);
      return { claimed: true, adminId: cand.adminId };
    }
    if (outcome === "case_gone") return { claimed: false, reason: "not_claimable" };
    // at_capacity / candidate_unavailable / candidate_busy: try the next candidate
  }
  await markUnassigned(row, cityId, "all_at_capacity");
  return { claimed: false, reason: "all_at_capacity" };
}

function assertCityAccess(actor, cityId) {
  if (actor.role === "superadmin") return;
  const actorCity = Number(actor.cityId);
  const target = Number(cityId);
  // Fail closed: a non-superadmin without a real (positive integer) city reaches nothing, not even another city-less record.
  if (!Number.isInteger(actorCity) || actorCity <= 0 || !Number.isInteger(target) || actorCity !== target) throw httpError(404, "Not found");
}

/** Case leaves its owner and returns to the unassigned queue; the owner's period is ended with `endReason`. */
async function releaseToUnassigned(caseRow, cityId, { endReason, reason = null, assignedBy = null }) {
  const released = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const swapped = await tx.booking_guarantee_case.updateMany({
      where: { id: caseRow.id, status: "open", owner_admin_id: caseRow.owner_admin_id },
      data: { owner_admin_id: null, owner_assigned_at: null, queue_state: "unassigned" },
    });
    if (swapped.count === 0) return false;
    await endActiveAssignment(caseRow.id, endReason, tx, now);
    await writeAudit(tx, caseRow.id, caseRow.order_id, "exec_owner_released", { adminId: assignedBy, meta: { from: caseRow.owner_admin_id, endReason, reason } });
    return true;
  }, TX_OPTIONS);
  if (!released) return false;
  const candidates = await listCandidates(cityId);
  await markUnassigned({ ...caseRow, owner_admin_id: null }, cityId, rules.unassignedReason(candidates));
  return true;
}

/** Hand an owned case to the best OTHER executive; if nobody has capacity it returns to the unassigned queue. */
async function reassignAuto(caseRow, { cityId, endReason = "reassigned", source = "auto", assignedBy = null, reason = null, idleBefore }) {
  const city = await queueSettings.getQueueSettings(cityId);
  const candidates = (await listCandidates(cityId)).filter((c) => c.adminId !== caseRow.owner_admin_id);
  const ranked = rankFor(candidates, city);
  for (const cand of ranked.slice(0, MAX_CLAIM_ATTEMPTS)) {
    const outcome = await tryAssign(caseRow.id, cand.adminId, {
      cityId, expectedOwnerId: caseRow.owner_admin_id, source, assignedBy, endReason, reason, idleBefore,
    });
    if (outcome === "claimed") {
      notify("guarantee_assigned", { ...caseRow, owner_admin_id: cand.adminId }, cityId);
      return { claimed: true, adminId: cand.adminId, queueState: "assigned" };
    }
    if (outcome === "case_gone") return { claimed: false, queueState: "unchanged" }; // someone else changed the owner
  }
  if (caseRow.owner_admin_id == null) {
    // Already unowned: nothing to release, just keep it visible as unassigned with a reason.
    await markUnassigned(caseRow, cityId, rules.unassignedReason(await listCandidates(cityId)));
    return { claimed: false, queueState: "unassigned" };
  }
  const done = await releaseToUnassigned(caseRow, cityId, { endReason, reason, assignedBy });
  return { claimed: false, queueState: done ? "unassigned" : "unchanged" };
}

/**
 * Supervisor reassignment. targetAdminId given: that executive must be active, available, in the case's city and
 * below capacity, else 409 and nothing changes. targetAdminId null: automatic (see reassignAuto). deadline_at is never touched.
 */
async function reassignCase({ orderId, targetAdminId = null, actor, reason }) {
  const why = String(reason ?? "").trim().slice(0, 200);
  if (!why) throw httpError(400, "A reason is required");
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (!row || row.city_id == null) throw httpError(404, "Not found");
  assertCityAccess(actor, row.city_id);
  if (row.status !== "open") throw httpError(409, "This guarantee case is already closed");
  if (!row.queue_state) throw httpError(409, "The executive queue is not active for this case");

  const cityId = row.city_id;
  if (targetAdminId == null) {
    const res = await reassignAuto(row, { cityId, source: "manual", assignedBy: actor.id, reason: why });
    if (res.queueState === "unchanged") throw httpError(409, "Case ownership changed. Refresh and retry");
    return { queueState: res.queueState, ownerAdminId: res.adminId ?? null };
  }
  const target = Number(targetAdminId);
  if (!Number.isInteger(target) || target <= 0) throw httpError(400, "target_admin_id must be a valid id");
  if (target === row.owner_admin_id) throw httpError(409, "That executive already owns this case");
  // Only a real executive of the case's city may get a profile row / lock (never create one for an arbitrary admin id).
  const targetAdmin = await prisma.admin.findUnique({ where: { id: target }, select: { role: true, city_id: true } });
  if (!targetAdmin || targetAdmin.role !== "executive" || Number(targetAdmin.city_id) !== Number(cityId)) {
    throw httpError(409, "That executive is unavailable, inactive or not in this city");
  }
  const outcome = await tryAssign(row.id, target, {
    cityId, expectedOwnerId: row.owner_admin_id, source: "manual", assignedBy: actor.id, endReason: "reassigned", reason: why,
  });
  if (outcome === "claimed") {
    notify("guarantee_assigned", { ...row, owner_admin_id: target }, cityId);
    return { queueState: "assigned", ownerAdminId: target };
  }
  const messages = {
    at_capacity: "That executive is at capacity",
    candidate_unavailable: "That executive is unavailable, inactive or not in this city",
    candidate_busy: "That executive is busy. Retry",
    case_gone: "Case ownership changed. Refresh and retry",
  };
  throw httpError(409, messages[outcome] || "Could not reassign");
}

/**
 * Auto mode: hand the oldest waiting cases (open, unowned, with a ready Trial Driver) to free executives, right now.
 * Called wherever an executive may have become free. Stops at the first case nobody can take. Returns the count claimed.
 */
async function dispatchWaiting(cityId) {
  const city = Number(cityId);
  if (!Number.isInteger(city) || city <= 0 || !isAutoMode(await queueSettings.getQueueSettings(city))) return 0;
  const waiting = await prisma.$queryRaw(Prisma.sql`
    SELECT c.id AS id FROM booking_guarantee_case c
    JOIN guarantee_outside_candidate g ON g.case_id = c.id AND g.active = 1
    WHERE c.status = 'open' AND c.owner_admin_id IS NULL AND c.city_id = ${city} AND c.deadline_at > ${new Date()}
    ORDER BY c.opened_at ASC, c.id ASC LIMIT 50`);
  let claimed = 0;
  for (const w of waiting) {
    const res = await claimCase(Number(w.id), { cityId: city });
    if (res.claimed) claimed += 1;
    else if (res.reason !== "not_claimable" && res.reason !== "awaiting_driver") break; // nobody free: the rest wait too
  }
  return claimed;
}

/** Best-effort wrapper for hooks: a failure here is repaired by the next sweeper tick. */
async function dispatchWaitingSafe(cityId) {
  try {
    return await dispatchWaiting(cityId);
  } catch (err) {
    logger.error(`guaranteeQueue: dispatchWaiting failed for city ${cityId}:`, err);
    return 0;
  }
}

/**
 * The owning executive rejects the offered Trial Driver (Not Convinced). One transaction records the rejection,
 * ends the executive's period (they are Free at once) and returns the case to the queue; then the next search starts
 * and the next waiting case goes to a free executive.
 */
async function rejectCandidate({ orderId, actor, reason }) {
  if (!actor || actor.role !== "executive") throw httpError(403, "Only the owning executive can reject a driver");
  const row = await loadCaseFor(orderId, actor); // 404 unless this executive owns it
  if (row.status !== "open") throw httpError(409, "This guarantee case is already closed");
  const live = await outsideCandidates.getLive(row.id);
  if (!live) throw httpError(409, "There is no offered driver to reject");
  const why = reason ? String(reason).trim().slice(0, 200) : null;

  const done = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const swapped = await tx.booking_guarantee_case.updateMany({
      where: { id: row.id, status: "open", owner_admin_id: actor.id },
      data: { owner_admin_id: null, owner_assigned_at: null, queue_state: "unassigned" },
    });
    if (swapped.count === 0) return false;
    if (!(await outsideCandidates.reject({ caseId: row.id, adminId: actor.id, reason: why, client: tx }))) {
      throw httpError(409, "The offered driver changed. Refresh and retry");
    }
    await endActiveAssignment(row.id, "driver_rejected", tx, now);
    await writeAudit(tx, row.id, row.order_id, "outside_driver_rejected", {
      adminId: actor.id, meta: { rider_id: live.rider_id, mobile: live.mobile, reason: why },
    });
    return true;
  }, TX_OPTIONS);
  if (!done) throw httpError(404, "Not found"); // ownership changed under us

  outsideSearch().startForCase(row.id);
  await dispatchWaitingSafe(row.city_id);
  return { released: true };
}

async function loadExecutive(adminId, actor) {
  const a = await prisma.admin.findUnique({ where: { id: Number(adminId) }, select: { id: true, role: true, city_id: true } });
  if (!a || a.role !== "executive") throw httpError(404, "Not found");
  assertCityAccess(actor, a.city_id);
  return a;
}

async function handoverOwnedCases(adminId, cityId, assignedBy) {
  const owned = await prisma.booking_guarantee_case.findMany({ where: { status: "open", owner_admin_id: adminId } });
  let n = 0;
  for (const c of owned) {
    const res = await reassignAuto(c, { cityId: c.city_id ?? cityId, endReason: "unavailable", source: "auto", assignedBy, reason: "owner unavailable" });
    if (res.queueState !== "unchanged") n += 1;
  }
  return n;
}

async function setAvailability(adminId, available, actor) {
  const exec = await loadExecutive(adminId, actor);
  await ensureProfile(exec.id);
  await prisma.executive_guarantee_profile.update({ where: { admin_id: exec.id }, data: { available: available ? 1 : 0, updated_by: actor.id, updated_at: new Date() } });
  if (available) {
    await dispatchWaitingSafe(exec.city_id); // newly free: take the oldest waiting case
    return { handedOver: 0 };
  }
  const handedOver = await handoverOwnedCases(exec.id, exec.city_id, actor.id);
  await dispatchWaitingSafe(exec.city_id);
  return { handedOver };
}

async function setCapacity(adminId, capacity, actor) {
  const exec = await loadExecutive(adminId, actor);
  let value = null;
  if (capacity !== null && capacity !== undefined && capacity !== "") {
    value = Number(capacity);
    if (!Number.isInteger(value) || value < rules.LIMITS.capacity[0] || value > rules.LIMITS.capacity[1]) throw httpError(400, "capacity must be a whole number between 1 and 200");
  }
  await ensureProfile(exec.id);
  await prisma.executive_guarantee_profile.update({ where: { admin_id: exec.id }, data: { capacity: value, updated_by: actor.id, updated_at: new Date() } });
  return { capacity: value };
}

/** Called from openForExhaustedOrder (best-effort). A city with the queue OFF is left exactly as before. */
async function onCaseOpened(caseRow, cityId) {
  // The case's own city is authoritative; a missing or mismatching caller city never queues it.
  const caseCity = Number(caseRow.city_id);
  if (!Number.isInteger(caseCity) || caseCity <= 0 || Number(cityId) !== caseCity) return { queued: false };
  cityId = caseCity;
  const city = await queueSettings.getQueueSettings(cityId);
  if (!city.execQueueEnabled) return { queued: false };
  const set = await prisma.booking_guarantee_case.updateMany({
    where: { id: caseRow.id, status: "open", queue_state: null }, data: { queue_state: "unassigned" },
  });
  if (set.count === 0) return { queued: false };
  await writeAudit(prisma, caseRow.id, caseRow.order_id, "exec_queue_unassigned");
  if (isAutoMode(city)) {
    // The bot finds a Trial Driver first; the case reaches an executive only once one is ready (dispatchWaiting).
    outsideSearch().startForCase(caseRow.id);
    return { queued: true };
  }
  await claimCase(caseRow.id, { cityId });
  return { queued: true };
}

/** Called after a case closes (assign / cancel / expire). Best-effort: the repair pass covers a failure here. */
async function onCaseClosed(caseRow, status) {
  const endReason = Object.prototype.hasOwnProperty.call(END_REASON_FOR_STATUS, status) ? END_REASON_FOR_STATUS[status] : null;
  if (!endReason) return 0;
  const current = await prisma.booking_guarantee_case.findUnique({ where: { id: caseRow.id }, select: { status: true } });
  if (!current || current.status === "open") return 0;
  const ended = await endActiveAssignment(caseRow.id, endReason);
  // Auto mode: a driver still on offer is no longer needed, and the executive just freed gets the next waiting case.
  try {
    await outsideCandidates.supersedeLive(caseRow.id, "case_closed");
  } catch (err) {
    logger.error(`guaranteeQueue: superseding candidate of case ${caseRow.id} failed:`, err);
  }
  if (caseRow.city_id != null) await dispatchWaitingSafe(caseRow.city_id);
  return ended;
}


const SAFE_META_KEYS = ["note", "outcome", "reason"];
const SUPERVISOR_ACTIONS = new Set(["note", "escalated", "viewed"]);

function cleanMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const out = {};
  for (const key of SAFE_META_KEYS) {
    if (meta[key] === undefined || meta[key] === null) continue;
    out[key] = String(meta[key]).slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}

/** Loads the case for an actor, enforcing city scope (404) and, for executives, current ownership (404). */
async function loadCaseFor(orderId, actor) {
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (!row || row.city_id == null) throw httpError(404, "Not found");
  assertCityAccess(actor, row.city_id);
  if (actor.role === "executive" && row.owner_admin_id !== actor.id) throw httpError(404, "Not found");
  return row;
}

async function recordAction({ orderId, actor, type, result = null, driverId = null, meta = null }) {
  if (!rules.ACTION_TYPES.includes(type)) throw httpError(400, "Unknown action type");
  const row = await loadCaseFor(orderId, actor);
  if (actor.role !== "executive" && !SUPERVISOR_ACTIONS.has(type)) throw httpError(403, "Only the owning executive can record this action");
  const safe = cleanMeta(meta);
  // Only the owning executive's actions count as progress; supervisor notes/escalations stay audit-visible (meaningful = 0).
  const meaningful = actor.role === "executive" && rules.isMeaningful(type, safe?.note) ? 1 : 0;
  if (meaningful && row.status !== "open") throw httpError(409, "This guarantee case is already closed");

  const now = new Date();
  const created = await prisma.guarantee_action.create({
    data: {
      case_id: row.id, admin_id: actor.id, type, meaningful, result: result ? String(result).slice(0, 30) : null,
      driver_id: Number.isInteger(Number(driverId)) && Number(driverId) > 0 ? Number(driverId) : null, meta: safeJson(safe), created_at: now,
    },
  });
  // Only the owning executive's meaningful actions count as the case making progress.
  // Every write is conditional on the actor STILL owning the open case, so a reassignment between the read and here is harmless.
  if (meaningful) {
    const own = { id: row.id, owner_admin_id: actor.id, status: "open" };
    await prisma.booking_guarantee_case.updateMany({ where: { ...own, first_action_at: null }, data: { first_action_at: now } });
    await prisma.booking_guarantee_case.updateMany({ where: own, data: { last_action_at: now } });
    await prisma.booking_guarantee_case.updateMany({ where: { ...own, queue_state: "assigned" }, data: { queue_state: "in_progress" } });
  }
  if (type === "escalated" && row.status === "open") {
    const esc = await prisma.booking_guarantee_case.updateMany({
      where: { id: row.id, status: "open", escalated_at: null },
      data: { escalated_at: now },
    });
    if (esc.count === 1) {
      // An unowned case keeps 'unassigned'; the state only flips while someone currently owns it.
      await prisma.booking_guarantee_case.updateMany({ where: { id: row.id, status: "open", owner_admin_id: { not: null } }, data: { queue_state: "escalated" } });
      await writeAudit(prisma, row.id, row.order_id, "exec_escalated", { adminId: actor.id, meta: safe });
      notify("guarantee_escalated", row, row.city_id, { by: actor.id });
    }
  }
  return { id: created.id, meaningful: Boolean(meaningful) };
}

/** assignRider hook: the assigning admin's driver assignment is a meaningful action. Never throws. */
async function recordAssignmentAction({ orderId, adminId, riderId }) {
  try {
    const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
    if (!row || !row.queue_state) return;
    const now = new Date();
    const isOwner = row.owner_admin_id != null && Number(adminId) === row.owner_admin_id;
    await prisma.guarantee_action.create({
      data: { case_id: row.id, admin_id: Number(adminId), type: "driver_assigned", meaningful: isOwner ? 1 : 0, driver_id: Number(riderId) || null, created_at: now },
    });
    if (isOwner) {
      const own = { id: row.id, owner_admin_id: Number(adminId), status: "open" };
      await prisma.booking_guarantee_case.updateMany({ where: { ...own, first_action_at: null }, data: { first_action_at: now } });
      await prisma.booking_guarantee_case.updateMany({ where: own, data: { last_action_at: now } });
      await prisma.booking_guarantee_case.updateMany({ where: { ...own, queue_state: "assigned" }, data: { queue_state: "in_progress" } });
      await outsideCandidates.markAssigned(row.id, Number(riderId));
    }
  } catch (err) {
    logger.error(`guaranteeQueue: recording driver_assigned for order ${orderId} failed:`, err);
  }
}

/**
 * Server-side ownership rule: while a city's queue is ON, an executive may assign a driver only to a guarantee
 * case they currently own. Admins and superadmins are unaffected, as is any order without an open queued case
 * and any city with the queue OFF (so turning the flag off restores today's behaviour).
 */
async function assertExecutiveMayAssign(user, orderId, riderId) {
  if (!user || user.role !== "executive") return;
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (!row || row.status !== "open" || !row.queue_state || row.city_id == null) return;
  const city = await queueSettings.getQueueSettings(row.city_id);
  if (!city.execQueueEnabled) return;
  if (row.owner_admin_id !== user.id) throw httpError(403, "This Booking Guarantee case is owned by another executive");
  // Auto mode: the executive decides on the offered Trial Driver, not an arbitrary one.
  if (isAutoMode(city) && riderId != null) {
    const live = await outsideCandidates.getLive(row.id);
    if (live && Number(riderId) !== Number(live.rider_id)) throw httpError(403, "Assign the Trial Driver offered for this case");
  }
}

const CASE_FIELDS = {
  id: true, order_id: true, city_id: true, status: true, queue_state: true, unassigned_reason: true, opened_at: true, deadline_at: true,
  owner_admin_id: true, owner_assigned_at: true, first_action_at: true, last_action_at: true, reminded_at: true, escalated_at: true,
  closed_at: true, compensation_amount: true, selected_package_ids: true, search_state: true,
};

const ORDER_FIELDS = {
  id: true, category: true, pick_name: true, drop_name: true, plat: true, plong: true, dlat: true, dlong: true,
  total_dcharge: true, distance: true,
};

/** Adds the live Trial Driver (with an online flag) and the order's key details to each case, in a few queries. */
async function attachOffer(cases) {
  if (!cases.length) return cases;
  const live = await prisma.guarantee_outside_candidate.findMany({ where: { case_id: { in: cases.map((c) => c.id) }, active: 1 } });
  const riders = live.length
    ? await prisma.tbl_rider.findMany({ where: { id: { in: live.map((l) => l.rider_id) } }, select: { id: true, a_status: true, status: true, trial_status: true } })
    : [];
  const riderBy = new Map(riders.map((r) => [r.id, r]));
  const orders = await prisma.pkg_order.findMany({ where: { id: { in: cases.map((c) => c.order_id) } }, select: ORDER_FIELDS });
  const orderBy = new Map(orders.map((o) => [o.id, o]));
  const liveBy = new Map(live.map((l) => [l.case_id, l]));
  return cases.map((c) => {
    const l = liveBy.get(c.id);
    const r = l ? riderBy.get(l.rider_id) : null;
    const o = orderBy.get(c.order_id);
    return {
      ...c,
      candidate: l ? {
        id: l.id, rider_id: l.rider_id, name: l.name, mobile: l.mobile, vehicle_number: l.vehicle_number, vehicle_name: l.vehicle_name,
        fare: l.fare == null ? null : Number(l.fare), status: l.status, trial_status: r ? r.trial_status : null,
        online: Boolean(r && r.a_status === 1 && r.status === 1),
      } : null,
      order: o ? { ...o, fare: o.total_dcharge == null ? null : Number(o.total_dcharge) } : null,
    };
  });
}

async function getCaseDetail(orderId, actor) {
  const row = await loadCaseFor(orderId, actor);
  if (actor.role === "executive") await recordAction({ orderId, actor, type: "viewed" });
  const [full, assignments, actions, audit] = await Promise.all([
    prisma.booking_guarantee_case.findUnique({ where: { id: row.id }, select: CASE_FIELDS }),
    prisma.guarantee_assignment.findMany({ where: { case_id: row.id }, orderBy: { id: "asc" } }),
    prisma.guarantee_action.findMany({ where: { case_id: row.id }, orderBy: { id: "desc" }, take: 100 }),
    prisma.booking_guarantee_audit.findMany({ where: { case_id: row.id }, orderBy: { id: "asc" } }),
  ]);
  const [withOffer] = await attachOffer([full]);
  return { case: withOffer, assignments, actions, audit, candidate: withOffer.candidate, order: withOffer.order };
}

async function listMyCases(adminId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [active, recent, away] = await Promise.all([
    prisma.booking_guarantee_case.findMany({ where: { owner_admin_id: adminId, status: "open" }, orderBy: { deadline_at: "asc" }, select: CASE_FIELDS }),
    prisma.booking_guarantee_case.findMany({ where: { owner_admin_id: adminId, status: { not: "open" }, closed_at: { gte: since } }, orderBy: { closed_at: "desc" }, take: 50, select: CASE_FIELDS }),
    prisma.guarantee_assignment.findMany({
      where: { admin_id: adminId, end_reason: { in: ["reassigned", "unavailable", "idle_auto_reassign"] }, ended_at: { gte: since } },
      orderBy: { ended_at: "desc" }, take: 50,
    }),
  ]);
  const awayCases = away.length
    ? await prisma.booking_guarantee_case.findMany({ where: { id: { in: away.map((a) => a.case_id) } }, select: CASE_FIELDS })
    : [];
  return { active: await attachOffer(active), recent, reassigned: awayCases };
}

async function maybeRemind(c, city, now) {
  if (!rules.isReminderDue(c, city, now)) return;
  const res = await prisma.booking_guarantee_case.updateMany({ where: { id: c.id, status: "open", reminded_at: null }, data: { reminded_at: now } });
  if (res.count !== 1) return; // another tick or instance already sent it
  await writeAudit(prisma, c.id, c.order_id, "exec_reminder_sent", { meta: { owner: c.owner_admin_id ?? null } });
  notify("guarantee_reminder", c, c.city_id, { pct: city.reminderPct });
}

async function maybeEscalate(c, city, now) {
  if (!rules.isEscalationDue(c, city, now)) return;
  // (a) once-only CAS on escalated_at; (b) mark the state from the LIVE owner, so an unowned case stays unassigned
  const res = await prisma.booking_guarantee_case.updateMany({ where: { id: c.id, status: "open", escalated_at: null }, data: { escalated_at: now } });
  if (res.count !== 1) return;
  await prisma.booking_guarantee_case.updateMany({ where: { id: c.id, status: "open", owner_admin_id: { not: null } }, data: { queue_state: "escalated" } });
  await writeAudit(prisma, c.id, c.order_id, "exec_escalated", { meta: { owner: c.owner_admin_id ?? null, pct: city.escalatePct, by: "system" } });
  notify("guarantee_escalated", c, c.city_id, { pct: city.escalatePct });
}

async function ownerStates(ownerIds) {
  if (!ownerIds.length) return new Map();
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT a.id AS admin_id, a.role AS role, a.status AS status, a.city_id AS city_id, COALESCE(p.available, 1) AS available
    FROM admin a LEFT JOIN executive_guarantee_profile p ON p.admin_id = a.id
    WHERE a.id IN (${Prisma.join(ownerIds)})`);
  return new Map(rows.map((r) => [Number(r.admin_id), {
    ok: r.role === "executive" && Number(r.status) === 1 && Number(r.available) === 1, cityId: r.city_id,
  }]));
}

/** Assign unowned cases, hand over cases whose owner is no longer eligible, send reminders/escalations, idle-reassign.
 *  Never writes status/deadline/compensation: expiry owns every case at or past its deadline. */
async function processOpenCases(now) {
  const cases = await prisma.booking_guarantee_case.findMany({
    where: { status: "open", queue_state: { not: null }, city_id: { not: null }, deadline_at: { gt: now } }, orderBy: { deadline_at: "asc" }, take: TICK_BATCH,
  });
  const owners = await ownerStates([...new Set(cases.map((c) => c.owner_admin_id).filter(Boolean))]);
  let processed = 0;
  for (const c of cases) {
    if (c.city_id == null || c.queue_state == null || new Date(c.deadline_at) <= now) continue;
    try {
      const city = await queueSettings.getQueueSettings(c.city_id);
      if (!city.execQueueEnabled) continue;
      processed += 1;
      let cur = c; // the row used for alerts: refreshed after a successful claim so the new owner is on it
      if (!c.owner_admin_id) {
        const claim = await claimCase(c.id, { cityId: c.city_id });
        if (claim.claimed) {
          cur = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
          if (!cur || cur.status !== "open") continue;
        }
      } else {
        const owner = owners.get(c.owner_admin_id);
        if (!owner || !owner.ok || Number(owner.cityId) !== Number(c.city_id)) {
          await reassignAuto(c, { cityId: c.city_id, endReason: "unavailable", source: "auto", reason: "owner no longer eligible" });
          continue;
        }
      }
      await maybeRemind(cur, city, now);
      await maybeEscalate(cur, city, now);
      if (c.owner_admin_id && rules.isIdle(c, city, now, MIN_HANDOVER_MS)) {
        // Only hand over when another executive can actually take it; otherwise keep the owner (no release/claim ping-pong).
        const others = (await listCandidates(c.city_id)).filter((x) => x.adminId !== c.owner_admin_id);
        if (rankFor(others, city).length > 0) {
          const idleBefore = new Date(now.getTime() - city.autoReassignIdleMinutes * 60 * 1000);
          const res = await reassignAuto(c, { cityId: c.city_id, endReason: "idle_auto_reassign", source: "escalation", reason: "owner idle", idleBefore });
          if (res.queueState !== "unchanged") {
            await writeAudit(prisma, c.id, c.order_id, "exec_auto_reassigned_idle", {
              meta: { from: c.owner_admin_id, to: res.adminId ?? null, queueState: res.queueState },
            });
          }
        }
      }
    } catch (err) {
      logger.error(`guaranteeQueue: processing case ${c.id} failed:`, err);
    }
  }
  return processed;
}

/** Reconciles ownership with case state. Runs even for cities whose queue is OFF. Idempotent. Each step and row is contained. */
async function repairOrphans(now) {
  let repaired = 0;
  // 1) active period on a closed case (any non-open status: cancelled, resolved_assigned, expired_compensated)
  try {
    const stale = await prisma.$queryRaw(Prisma.sql`
      SELECT ga.id AS id, ga.case_id AS case_id, c.order_id AS order_id, c.status AS status
      FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id
      WHERE ga.active = 1 AND c.status <> 'open' LIMIT ${REPAIR_BATCH}`);
    for (const s of stale) {
      try {
        const res = await prisma.guarantee_assignment.updateMany({
          where: { id: Number(s.id), active: 1 },
          data: { active: null, ended_at: now, end_reason: END_REASON_FOR_STATUS[s.status] || "resolved" },
        });
        if (res.count === 1) {
          repaired += 1;
          await writeAudit(prisma, Number(s.case_id), Number(s.order_id), "exec_assignment_repaired", { meta: { kind: "closed_case_active_period" } });
        }
      } catch (err) {
        logger.error(`guaranteeQueue: repair step 1 failed for period ${s.id}:`, err);
      }
    }
  } catch (err) {
    logger.error("guaranteeQueue: repair step 1 failed:", err);
  }
  // 2) open case with an owner but no active period. The insert happens under a lock on the case row and only if
  // that exact owner still owns the open case, so a case released a moment ago is never resurrected.
  try {
    const noPeriod = await prisma.$queryRaw(Prisma.sql`
      SELECT c.id AS id, c.order_id AS order_id, c.owner_admin_id AS owner_admin_id, c.owner_assigned_at AS owner_assigned_at
      FROM booking_guarantee_case c
      WHERE c.status = 'open' AND c.owner_admin_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM guarantee_assignment ga WHERE ga.case_id = c.id AND ga.active = 1) LIMIT ${REPAIR_BATCH}`);
    for (const r of noPeriod) {
      try {
        const done = await prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw(Prisma.sql`
            SELECT id FROM booking_guarantee_case WHERE id = ${Number(r.id)} AND status = 'open' AND owner_admin_id = ${Number(r.owner_admin_id)} FOR UPDATE`);
          if (!locked.length) return false;
          const active = await tx.guarantee_assignment.count({ where: { case_id: Number(r.id), active: 1 } });
          if (active > 0) return false;
          await tx.guarantee_assignment.create({
            data: { case_id: Number(r.id), admin_id: Number(r.owner_admin_id), source: "auto", started_at: r.owner_assigned_at || now, active: 1 },
          });
          return true;
        }, TX_OPTIONS);
        if (done) {
          repaired += 1;
          await writeAudit(prisma, Number(r.id), Number(r.order_id), "exec_assignment_repaired", { meta: { kind: "owner_without_period" } });
        }
      } catch (err) {
        if (!err || err.code !== "P2002") logger.error(`guaranteeQueue: repair step 2 failed for case ${r.id}:`, err);
      }
    }
  } catch (err) {
    logger.error("guaranteeQueue: repair step 2 failed:", err);
  }
  // 3) open case whose active period names a different (or no) owner: the assignment table is authoritative
  try {
    const mismatch = await prisma.$queryRaw(Prisma.sql`
      SELECT ga.id AS period_id, c.id AS id, c.order_id AS order_id, ga.admin_id AS admin_id, ga.started_at AS started_at
      FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id
      WHERE ga.active = 1 AND c.status = 'open' AND (c.owner_admin_id IS NULL OR c.owner_admin_id <> ga.admin_id) LIMIT ${REPAIR_BATCH}`);
    for (const m of mismatch) {
      try {
        const done = await prisma.$transaction(async (tx) => {
          // Global lock order everywhere: profile row -> case row -> assignment (period) rows.
          const locked = await tx.$queryRaw(Prisma.sql`SELECT id FROM booking_guarantee_case WHERE id = ${Number(m.id)} AND status = 'open' FOR UPDATE`);
          if (!locked.length) return false;
          // that exact period must still be the active one
          const period = await tx.$queryRaw(Prisma.sql`SELECT id FROM guarantee_assignment WHERE id = ${Number(m.period_id)} AND active = 1 FOR UPDATE`);
          if (!period.length) return false;
          const res = await tx.booking_guarantee_case.updateMany({
            where: { id: Number(m.id), status: "open", OR: [{ owner_admin_id: null }, { owner_admin_id: { not: Number(m.admin_id) } }] },
            data: { owner_admin_id: Number(m.admin_id), owner_assigned_at: m.started_at || now, unassigned_reason: null },
          });
          if (res.count !== 1) return false;
          // queue_state becomes 'assigned' only from null/unassigned; in_progress / escalated are preserved
          await tx.booking_guarantee_case.updateMany({
            where: { id: Number(m.id), status: "open", owner_admin_id: Number(m.admin_id), OR: [{ queue_state: null }, { queue_state: "unassigned" }] },
            data: { queue_state: "assigned" },
          });
          return true;
        }, TX_OPTIONS);
        if (done) {
          repaired += 1;
          await writeAudit(prisma, Number(m.id), Number(m.order_id), "exec_assignment_repaired", { meta: { kind: "owner_mismatch" } });
        }
      } catch (err) {
        logger.error(`guaranteeQueue: repair step 3 failed for case ${m.id}:`, err);
      }
    }
  } catch (err) {
    logger.error("guaranteeQueue: repair step 3 failed:", err);
  }
  // 4) a live Trial Driver candidate on a closed case (the case closed while the driver was being registered)
  try {
    const cleared = await prisma.$executeRaw(Prisma.sql`
      UPDATE guarantee_outside_candidate g JOIN booking_guarantee_case c ON c.id = g.case_id
      SET g.status = 'superseded', g.active = NULL, g.reject_reason = 'case_closed'
      WHERE g.active = 1 AND c.status <> 'open'`);
    repaired += Number(cleared) || 0;
  } catch (err) {
    logger.error("guaranteeQueue: repair step 4 failed:", err);
  }
  return repaired;
}

/** One sweeper pass; called right after expireDue(). Every step is contained so one failure never stops the others. */
async function tick(now = new Date()) {
  const out = { processed: 0, repaired: 0, searched: 0 };
  // Auto mode: (re)start searches for cases with no live Trial Driver (recovers a crashed worker or a restart).
  try { out.searched = await outsideSearch().sweep(now); } catch (err) { logger.error("guaranteeQueue: outside search sweep failed:", err); }
  try { out.processed = await processOpenCases(now); } catch (err) { logger.error("guaranteeQueue: processOpenCases failed:", err); }
  try { out.repaired = await repairOrphans(now); } catch (err) { logger.error("guaranteeQueue: repairOrphans failed:", err); }
  return out;
}

module.exports = {
  END_REASON_FOR_STATUS, TX_OPTIONS, httpError,
  writeAudit, notify, ensureProfile, listCandidates, endActiveAssignment, tryAssign, markUnassigned, claimCase,
  assertCityAccess, releaseToUnassigned, reassignAuto, reassignCase, setAvailability, setCapacity, onCaseOpened, onCaseClosed,
  dispatchWaiting, rejectCandidate,
  recordAction, recordAssignmentAction, assertExecutiveMayAssign, getCaseDetail, listMyCases,
  tick, processOpenCases, repairOrphans,
};
