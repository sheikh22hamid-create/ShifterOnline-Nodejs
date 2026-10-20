const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./guaranteeQueueRules");

const TTL_MS = 5000;
const cache = new Map(); // cityId -> { at, value }

const COLUMN = {
  execQueueEnabled: "exec_queue_enabled",
  recoverOnDriverCancel: "guarantee_recover_on_cancel",
  autoOutsideSearch: "exec_auto_outside_search",
  execDefaultCapacity: "exec_default_capacity",
  reminderPct: "reminder_pct",
  escalatePct: "escalate_pct",
  autoReassignIdleMinutes: "auto_reassign_idle_minutes",
};

/**
 * The city's executive-queue settings. Fail closed: a missing city/row or any read error gives a DISABLED
 * queue, so a settings outage can never change who may assign a guarantee case.
 */
async function getQueueSettings(cityId, { fresh = false } = {}) {
  const id = Number(cityId);
  if (!Number.isInteger(id) || id <= 0) return { ...rules.DEFAULTS };
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const row = await prisma.city_order_settings.findUnique({ where: { city_id: id } });
    const value = rules.normalizeQueueRow(row);
    cache.set(id, { at: Date.now(), value });
    return value;
  } catch (err) {
    logger.warn(`guaranteeQueueSettings.getQueueSettings: city ${id} unreadable, queue treated as OFF: ${err.message}`);
    return { ...rules.DEFAULTS };
  }
}

async function saveQueueSettings({ cityId, input, adminId }) {
  const id = Number(cityId);
  const city = Number.isInteger(id) && id > 0 ? await prisma.tbl_city.findUnique({ where: { id } }) : null;
  if (!city) throw Object.assign(new Error("Unknown city"), { statusCode: 400 });
  const current = await getQueueSettings(id, { fresh: true });
  const clean = rules.validateQueueInput(input, current);

  const data = {};
  for (const [key, value] of Object.entries(clean)) data[COLUMN[key]] = value;
  data.updated_by = adminId ?? null;
  await prisma.city_order_settings.upsert({ where: { city_id: id }, update: data, create: { city_id: id, ...data } });
  cache.delete(id);
  logger.info(`guarantee-queue settings city=${id} admin=${adminId ?? "-"} ${JSON.stringify(clean)}`);
  return getQueueSettings(id, { fresh: true });
}

/** Automatic outside-driver search is live for a city: the executive queue AND the auto switch are on. Fails closed. */
async function autoSearchActive(cityId) {
  const s = await getQueueSettings(cityId);
  return Boolean(s.execQueueEnabled && s.autoOutsideSearch);
}

const _resetCache = () => cache.clear();

module.exports = { getQueueSettings, saveQueueSettings, autoSearchActive, _resetCache };
