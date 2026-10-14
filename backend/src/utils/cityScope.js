const prisma = require("../config/db");

// City scoping for admin-panel handlers that are not behind scopeFilter. A superadmin sees every city; a
// city admin / executive is bound to the city on their token. The checks here fail closed: a city-bound
// caller with no valid city matches nothing instead of everything.

/** null = unrestricted (superadmin); otherwise the caller's city id (0 when the token carries none). */
function callerCity(req) {
  if (!req.user || req.user.role === "superadmin") return null;
  const city = parseInt(req.user.city_id, 10);
  return Number.isInteger(city) && city > 0 ? city : 0;
}

async function cityMap(table, ids) {
  const unique = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!unique.length) return new Map();
  const rows = await prisma[table].findMany({ where: { id: { in: unique } }, select: { id: true, city_id: true } });
  return new Map(rows.map((r) => [r.id, Number(r.city_id)]));
}

/** Sends the 404/403 and returns false when the caller may not act on this driver/customer. */
async function assertInScope(req, res, table, id, label) {
  const city = callerCity(req);
  if (city === null) return true;
  const known = await cityMap(table, [id]);
  const key = Number(id);
  if (!known.has(key)) {
    res.status(404).json({ success: false, message: `${label} not found` });
    return false;
  }
  if (known.get(key) !== city) {
    res.status(403).json({ success: false, message: `This ${label.toLowerCase()} belongs to another city` });
    return false;
  }
  return true;
}
const assertRiderInScope = (req, res, riderId) => assertInScope(req, res, "tbl_rider", riderId, "Driver");
const assertUserInScope = (req, res, userId) => assertInScope(req, res, "tbl_user", userId, "Customer");

/** Keeps only the rows whose driver (or customer) is in the caller's city. Unrestricted callers get all rows. */
async function filterRows(req, rows, table, pick) {
  const city = callerCity(req);
  if (city === null || !rows.length) return rows;
  const known = await cityMap(table, rows.map(pick));
  return rows.filter((r) => known.get(Number(pick(r))) === city);
}
const filterByRider = (req, rows, pick = (r) => r.rider_id) => filterRows(req, rows, "tbl_rider", pick);
const filterByUser = (req, rows, pick = (r) => r.user_id) => filterRows(req, rows, "tbl_user", pick);

module.exports = { callerCity, assertRiderInScope, assertUserInScope, filterByRider, filterByUser };
