// Loading/Unloading labour pricing (spec 2026-11-24, Phase 1 Model A).
// Pure function: takes declared inputs + a resolved config object, returns the labour charge or an
// over-cap flag. No DB access here — labourSettings.getLabourConfig() supplies the config so this
// math stays unit-testable. Over-cap loads get NO price (Phase 1 shows "crew coming soon").

const SIZE_ORDER = { small: 1, medium: 2, large: 3 };
const FLOOR_ORDER = { ground: 1, f1_2: 2, f3plus: 3 };
const QTY_ORDER = { q15: 1, q15_40: 2, q40plus: 3 };

// Upper-floor premium, softened when a lift is available.
function floorMultiplier(floor, lift, floorMult) {
  if (floor === "ground") return 1;
  const base = floorMult[floor] ?? 1;
  if (!lift) return base;
  const liftFactor = floorMult.lift_factor ?? 1;
  return 1 + (base - 1) * liftFactor;
}

function legOverCap(leg, mode, caps) {
  if (mode === "home") {
    if (SIZE_ORDER[leg.size] > SIZE_ORDER[caps.max_size]) return true;
    if (FLOOR_ORDER[leg.floor] > FLOOR_ORDER[caps.max_floor]) return true;
    return false;
  }
  // shop
  if (QTY_ORDER[leg.qty] > QTY_ORDER[caps.max_qty]) return true;
  if ((caps.blocked_access || []).includes(leg.access)) return true;
  return false;
}

function legCharge(leg, mode, config) {
  if (mode === "home") {
    const size = config.sizeMult[leg.size] ?? 1;
    const floor = floorMultiplier(leg.floor, leg.lift, config.floorMult);
    return Math.round(config.baseHome * size * floor);
  }
  const qty = config.qtyMult[leg.qty] ?? 1;
  const access = config.accessMult[leg.access] ?? 1;
  return Math.round(config.baseShop * qty * access);
}

/**
 * @param {{mode:'home'|'shop', heavyItem?:boolean, legs:Array}} input
 * @param {object} config resolved labour config (see labourSettings.getLabourConfig)
 * @returns {{labourCharge:number, perLeg:Array, labourOverCap:boolean, disabled?:boolean}}
 */
function computeLabour(input, config) {
  if (!config || !config.enabled) {
    return { disabled: true, labourCharge: 0, labourOverCap: false, perLeg: [] };
  }
  const mode = input.mode === "shop" ? "shop" : "home";
  const legs = Array.isArray(input.legs) ? input.legs : [];

  const heavy = input.heavyItem === true;
  const anyOverCap = heavy || legs.some((leg) => legOverCap(leg, mode, config.caps));
  if (anyOverCap) {
    return { labourCharge: 0, perLeg: [], labourOverCap: true };
  }

  const perLeg = legs.map((leg) => ({ role: leg.role, charge: legCharge(leg, mode, config) }));
  const labourCharge = perLeg.reduce((sum, l) => sum + l.charge, 0);
  return { labourCharge, perLeg, labourOverCap: false };
}

module.exports = { computeLabour };
