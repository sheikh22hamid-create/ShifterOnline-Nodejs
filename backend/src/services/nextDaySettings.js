const prisma = require("../config/db");
const rules = require("./nextDayRules");

const OFFER_SECONDS_KEY = "next_day_offer_seconds";
const LIVE_TIME_KEY = "next_day_live_time";
const DEFAULT_OFFER_SECONDS = 60;
const OFFER_SECONDS_RANGE = [15, 600];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

async function read(key) {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: key } });
  return row && row.setting_value !== null && row.setting_value !== undefined ? String(row.setting_value) : null;
}
async function write(key, value) {
  await prisma.app_settings.upsert({
    where: { setting_key: key },
    update: { setting_value: String(value) },
    create: { setting_key: key, setting_value: String(value) },
  });
}

async function getOfferSeconds() {
  const n = parseInt(await read(OFFER_SECONDS_KEY), 10);
  return Number.isInteger(n) && n >= OFFER_SECONDS_RANGE[0] && n <= OFFER_SECONDS_RANGE[1] ? n : DEFAULT_OFFER_SECONDS;
}
function validateOfferSeconds(value) {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (!Number.isInteger(n) || n < OFFER_SECONDS_RANGE[0] || n > OFFER_SECONDS_RANGE[1]) {
    throw badRequest(`offer_seconds must be a whole number between ${OFFER_SECONDS_RANGE[0]} and ${OFFER_SECONDS_RANGE[1]}`);
  }
  return n;
}
async function setOfferSeconds(value) {
  const n = validateOfferSeconds(value);
  await write(OFFER_SECONDS_KEY, n);
  return n;
}

async function getLiveTime() {
  return rules.parseLiveTime(await read(LIVE_TIME_KEY));
}
function validateLiveTime(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!TIME_RE.test(v)) throw badRequest("live_time must be HH:MM (24-hour)");
  return v;
}
async function setLiveTime(value) {
  const v = validateLiveTime(value);
  await write(LIVE_TIME_KEY, v);
  return v;
}

module.exports = { getOfferSeconds, setOfferSeconds, validateOfferSeconds, getLiveTime, setLiveTime, validateLiveTime };
