const prisma = require('../config/db');
const { progressTrip } = require('../services/driverTripService');
const logger = require('../utils/logger');

async function syncProgress(req, res) {
  try {
    const riderId = Number(req.body.rider_id);
    const orderId = Number(req.body.order_id);
    if (!Number.isSafeInteger(riderId) || riderId <= 0 || !Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid driver or order' });
    }
    // Match the active login device as well as the assigned rider. The app's
    // existing rider APIs use this same device binding (no rider JWT exists).
    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { device_id: true } });
    if (!rider?.device_id || rider.device_id !== String(req.body.device_id || '')) {
      return res.status(403).json({ success: false, message: 'Please sign in on this device again' });
    }
    const data = await progressTrip({ orderId, riderId, action: req.body.action || 'sync', otp: req.body.otp, samples: req.body.samples || [], managed: true });
    return res.json({ success: true, data });
  } catch (error) {
    if (!error.statusCode) logger.error('Driver trip sync failed:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Trip update failed. Please retry.' });
  }
}
module.exports = { syncProgress };
