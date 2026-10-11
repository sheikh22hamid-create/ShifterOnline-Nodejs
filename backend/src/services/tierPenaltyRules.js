// Pure rules for tiered dispatch penalties (spec 2026-10-11). No I/O here.

const TIER = Object.freeze({ FREE: "free", DAILY: "daily", NORMAL: "normal" });
const STAGE_ORDER = Object.freeze([TIER.FREE, TIER.DAILY, TIER.NORMAL]);
const PENALTY_TIERS = Object.freeze([TIER.FREE, TIER.DAILY]);
const DEFAULT_LADDER = Object.freeze([5, 10, 20, 50, 100]);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** "5,10,20" -> [5,10,20]; entries outside (0,100] are dropped; nothing valid -> the default ladder. */
function parseLadder(raw) {
  const nums = String(raw ?? "")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return nums.length > 0 ? nums : [...DEFAULT_LADDER];
}

/** Percentage for the nth miss (1-based); the last ladder value applies from then on. */
function pctForMiss(ladder, missNo) {
  const list = Array.isArray(ladder) && ladder.length > 0 ? ladder : DEFAULT_LADDER;
  const n = Math.max(1, Math.floor(Number(missNo) || 1));
  return list[Math.min(n, list.length) - 1];
}

function penaltyAmount(baseAmount, pct) {
  const base = Number(baseAmount);
  const p = Number(pct);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(p) || p <= 0) return 0;
  return round2((base * p) / 100);
}

function nextStage(stage) {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null;
}

const isPenaltyTier = (tier) => PENALTY_TIERS.includes(tier);

module.exports = { TIER, STAGE_ORDER, PENALTY_TIERS, DEFAULT_LADDER, round2, parseLadder, pctForMiss, penaltyAmount, nextStage, isPenaltyTier };
