const prisma = require("../config/db");
const service = require("../services/goToHomeService");
const logger = require("../utils/logger");

// Driver app endpoint for Go to Home. Same device-bound identity check as favoriteRouteController.driver.
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const ACTIONS = { state: service.getState, save_home: service.saveHome, enable: service.enable, disable: service.disable };
const lastCall = new Map();

async function identify(body) {
  const id = Number(body.rider_id);
  if (!Number.isSafeInteger(id) || id <= 0) fail("Invalid driver");
  const rider = await prisma.tbl_rider.findUnique({ where: { id }, select: { id: true, city_id: true, device_id: true } });
  if (!rider?.device_id || rider.device_id !== String(body.device_id || "")) fail("Please sign in on this device again", 403);
  return rider;
}

exports.driver = async (req, res) => {
  try {
    const rider = await identify(req.body || {});
    const action = req.body.action || "state";
    const handler = ACTIONS[action];
    if (!handler) fail("Unknown action");
    if (action !== "state") { // one write per driver every 2 s: the routes API costs money
      const now = Date.now();
      if (now - (lastCall.get(rider.id) || 0) < 2000) fail("Please wait a moment before retrying", 429);
      lastCall.set(rider.id, now);
      if (lastCall.size > 10000) for (const [k, t] of lastCall) if (now - t > 60000) lastCall.delete(k);
    }
    res.json({ success: true, data: await handler(rider, req.body) });
  } catch (e) {
    if (!e.statusCode) logger.error("Go to Home failed", e);
    res.status(e.statusCode || 500).json({ success: false, message: e.statusCode ? e.message : "Go to Home is unavailable. Please retry." });
  }
};
