const logger = require("../utils/logger");
const queue = require("../services/guaranteeQueueService");
const reports = require("../services/guaranteeQueueReports");
const queueSettings = require("../services/guaranteeQueueSettings");

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`guaranteeQueue.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};
const actorOf = (req) => ({ id: req.user.id, role: req.user.role, cityId: req.user.city_id == null ? null : Number(req.user.city_id) });

const OUTCOME_CODES = ["agreed", "declined", "no_answer", "unreachable", "assigned", "none_available"];
const META_KEYS = ["note", "outcome", "reason"];
const MAX_REASON = 200;

// A positive safe integer from a JS number or a plain digit string. Never coerces booleans, '1e3', '', arrays, objects.
function parseId(v) {
  let n;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^[0-9]+$/.test(v)) n = Number(v);
  else return null;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
const idParam = (v, name) => {
  const id = parseId(v);
  if (id === null) throw httpError(400, `${name} must be a valid id`);
  return id;
};

// Strict boolean: true/false/'true'/'false'/1/0/'1'/'0'. Never Boolean('false').
function parseStrictBool(v, name) {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  throw httpError(400, `${name} must be true or false`);
}

// null/''/absent => null (clear the override); otherwise a whole number 1..200.
function parseCapacity(v) {
  if (v === null || v === "") return null;
  let n;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^[0-9]+$/.test(v)) n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 200) throw httpError(400, "capacity must be a whole number between 1 and 200");
  return n;
}

function parseMeta(meta) {
  if (meta === undefined || meta === null) return undefined;
  if (typeof meta !== "object" || Array.isArray(meta)) throw httpError(400, "meta must be an object");
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v !== "string" && !(typeof v === "number" && Number.isFinite(v))) throw httpError(400, "meta values must be strings or numbers");
    if (META_KEYS.includes(k)) out[k] = v;
  }
  return out;
}

// Fail closed: scopeFilter yields NaN for a non-superadmin without a city; never treat that as unscoped.
function scopeOf(req) {
  if (req.user?.role === "superadmin") return Number.isInteger(req.scopedCityId) ? req.scopedCityId : null;
  if (!Number.isInteger(req.scopedCityId)) throw httpError(403, "Your account is not assigned to a city");
  return req.scopedCityId;
}

// Superadmin names the city; everyone else is pinned to their own (never read from body/query).
function cityOf(req) {
  if (req.user.role === "superadmin") {
    const id = parseId(req.method === "GET" ? req.query?.city_id : (req.body?.city_id ?? req.query?.city_id));
    if (id === null) throw httpError(400, "city_id is required");
    return id;
  }
  const id = req.user.city_id == null ? NaN : Number(req.user.city_id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(403, "Your account is not assigned to a city");
  return id;
}

const settingsToApi = (s) => ({
  exec_queue_enabled: s.execQueueEnabled, guarantee_recover_on_cancel: s.recoverOnDriverCancel, exec_default_capacity: s.execDefaultCapacity,
  reminder_pct: s.reminderPct, escalate_pct: s.escalatePct, auto_reassign_idle_minutes: s.autoReassignIdleMinutes,
});

async function myCases(req, res) {
  try {
    return res.json({ success: true, data: await queue.listMyCases(req.user.id) });
  } catch (e) { return fail(res, e, "myCases"); }
}

async function caseDetail(req, res) {
  try {
    const orderId = idParam(req.params.orderId, "orderId");
    return res.json({ success: true, data: await queue.getCaseDetail(orderId, actorOf(req)) });
  } catch (e) { return fail(res, e, "caseDetail"); }
}

async function recordAction(req, res) {
  try {
    const orderId = idParam(req.params.orderId, "orderId");
    const b = req.body || {};
    if (typeof b.type !== "string") throw httpError(400, "type must be a string");
    let result;
    if (b.result !== undefined && b.result !== null && b.result !== "") {
      if (typeof b.result !== "string" || !OUTCOME_CODES.includes(b.result)) throw httpError(400, "result is not a valid outcome code");
      result = b.result;
    }
    const driverId = b.driver_id === undefined || b.driver_id === null ? undefined : idParam(b.driver_id, "driver_id");
    const meta = parseMeta(b.meta);
    const out = await queue.recordAction({ orderId, actor: actorOf(req), type: b.type, result, driverId, meta });
    return res.json({ success: true, data: out });
  } catch (e) { return fail(res, e, "recordAction"); }
}

async function reassign(req, res) {
  try {
    const orderId = idParam(req.params.orderId, "orderId");
    const raw = req.body?.target_admin_id;
    const targetAdminId = raw === null || raw === undefined || raw === "" ? null : idParam(raw, "target_admin_id");
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) throw httpError(400, "A reason is required");
    if (reason.length > MAX_REASON) throw httpError(400, `reason must be at most ${MAX_REASON} characters`);
    const out = await queue.reassignCase({ orderId, targetAdminId, actor: actorOf(req), reason });
    return res.json({ success: true, data: out });
  } catch (e) { return fail(res, e, "reassign"); }
}

async function queueView(req, res) {
  try {
    const cityId = scopeOf(req);
    const state = ["unassigned", "assigned", "in_progress", "escalated"].includes(req.query?.state) ? req.query.state : null;
    return res.json({ success: true, data: await reports.queueList({ cityId, state, limit: req.query?.limit }) });
  } catch (e) { return fail(res, e, "queue"); }
}

async function workload(req, res) {
  try {
    return res.json({ success: true, data: await reports.workload({ cityId: scopeOf(req) }) });
  } catch (e) { return fail(res, e, "workload"); }
}

async function report(req, res) {
  try {
    const cityId = scopeOf(req);
    const rawTo = req.query?.to;
    // a date-only `to` means the whole of that day (inclusive), in UTC
    const to = rawTo ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(rawTo)) ? `${rawTo}T23:59:59.999Z` : rawTo) : new Date();
    const from = req.query?.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw httpError(400, "from/to must be valid dates");
    if (from.getTime() > to.getTime()) throw httpError(400, "from must not be after to");
    if (to.getTime() - from.getTime() > 92 * 24 * 60 * 60 * 1000) throw httpError(400, "The report range may not exceed 92 days");
    return res.json({ success: true, data: await reports.report({ cityId, from, to }) });
  } catch (e) { return fail(res, e, "report"); }
}

async function saveProfile(req, res) {
  try {
    const adminId = idParam(req.params.adminId, "adminId");
    const actor = actorOf(req);
    const b = req.body || {};
    // Validate everything before changing anything so a bad field never leaves a half-applied update.
    const hasCapacity = b.capacity !== undefined;
    const hasAvailable = b.available !== undefined;
    const capacity = hasCapacity ? parseCapacity(b.capacity) : undefined;
    const available = hasAvailable ? parseStrictBool(b.available, "available") : undefined;
    const out = {};
    if (hasCapacity) out.capacity = (await queue.setCapacity(adminId, capacity, actor)).capacity;
    if (hasAvailable) {
      const r = await queue.setAvailability(adminId, available, actor);
      out.available = available;
      out.handed_over = r.handedOver;
    }
    return res.json({ success: true, data: out });
  } catch (e) { return fail(res, e, "saveProfile"); }
}

async function getSettings(req, res) {
  try {
    return res.json({ success: true, data: settingsToApi(await queueSettings.getQueueSettings(cityOf(req), { fresh: true })) });
  } catch (e) { return fail(res, e, "getSettings"); }
}

async function saveSettings(req, res) {
  try {
    const b = req.body || {};
    const saved = await queueSettings.saveQueueSettings({
      cityId: cityOf(req), adminId: req.user?.id,
      input: {
        execQueueEnabled: b.exec_queue_enabled, recoverOnDriverCancel: b.guarantee_recover_on_cancel, execDefaultCapacity: b.exec_default_capacity, reminderPct: b.reminder_pct,
        escalatePct: b.escalate_pct, autoReassignIdleMinutes: b.auto_reassign_idle_minutes,
      },
    });
    return res.json({ success: true, message: "Executive queue settings saved", data: settingsToApi(saved) });
  } catch (e) { return fail(res, e, "saveSettings"); }
}

module.exports = { myCases, caseDetail, recordAction, reassign, queue: queueView, workload, report, saveProfile, getSettings, saveSettings };
