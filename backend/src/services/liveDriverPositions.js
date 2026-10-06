// Last location ping per driver, kept in memory so the public tracking page can read a fresh
// position without a DB write per ping (tbl_rider is only written every few seconds). Single Node
// process: with several processes a page would see only its own process's pings and fall back to
// the DB value, which is acceptable.
const MAX_ENTRIES = 5000;
const MAX_AGE_MS = 60 * 60 * 1000;
const positions = new Map();

function record(riderId, lat, lng, heading, now = Date.now()) {
  positions.set(Number(riderId), { lat, lng, heading, at: now });
  if (positions.size > MAX_ENTRIES) {
    for (const [id, p] of positions) if (now - p.at > MAX_AGE_MS) positions.delete(id);
  }
}

const get = (riderId) => positions.get(Number(riderId)) || null;
const _clear = () => positions.clear();

module.exports = { record, get, _clear };
