// Loading/Unloading dispatch gating (spec 2026-11-24, Phase 1).
// Drivers opt into labour via tbl_rider.labour_mode (drive_only | light_only | full_loader). An order
// that needs labour is only OFFERED to a compatible driver — incompatible drivers are filtered out
// before the offer, so they never decline and never take a dispatch penalty (the invariant holds by
// construction, no change to the penalty logic). Pure here; dispatch wiring calls these.

/**
 * Classify how much labour an order needs: 'none' (no held labour), 'light' (small/ground home or
 * q15/shutter shop) or 'normal' (anything heavier within the booking cap). Unparseable labour is
 * treated as 'normal' (needs a full loader) to stay safe.
 */
function labourLevelOf(order) {
  if (!order || order.labour_opted !== true || order.labour_status !== "held") return "none";
  let decl;
  try {
    decl = JSON.parse(order.labour_declared_json || "null");
  } catch {
    return "normal";
  }
  if (!decl || !Array.isArray(decl.legs) || decl.legs.length === 0) return "normal";
  const mode = decl.mode === "shop" ? "shop" : "home";
  const allLight = decl.legs.every((leg) =>
    mode === "home"
      ? leg.size === "small" && leg.floor === "ground"
      : leg.qty === "q15" && leg.access === "shutter"
  );
  return allLight ? "light" : "normal";
}

/**
 * May a driver with this labour_mode be offered an order of this labour level?
 * Missing/unknown mode defaults to drive_only (the safest — never auto-assigned hard labour).
 */
function driverCanTakeLabourOrder(driverMode, level) {
  const mode = driverMode || "drive_only";
  if (level === "none") return true;
  if (level === "light") return mode !== "drive_only";
  if (level === "normal") return mode === "full_loader";
  return true;
}

module.exports = { labourLevelOf, driverCanTakeLabourOrder };
