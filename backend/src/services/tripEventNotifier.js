const prisma = require('../config/db');
const { sendPushNotification } = require('../config/firebase');
const dispatch = require('./dispatchManager');
const logger = require('../utils/logger');

async function flushTripEvents() {
  const now = new Date();
  const pending = await prisma.driver_trip_event.findMany({
    where: { sent_at: null, OR: [{ lease_until: null }, { lease_until: { lt: now } }] },
    orderBy: { id: 'asc' }, take: 50,
  });
  for (const event of pending) {
    const claimed = await prisma.driver_trip_event.updateMany({ where: {
      id: event.id, sent_at: null, OR: [{ lease_until: null }, { lease_until: { lt: now } }],
    }, data: { lease_until: new Date(Date.now() + 60000) } });
    if (!claimed.count) continue;
    try {
      const order = await prisma.pkg_order.findUnique({ where: { id: event.order_id }, select: { order_status: true } });
      const superseded = event.lease_until && await prisma.driver_trip_event.findFirst({
        where: { order_id: event.order_id, id: { gt: event.id } }, select: { id: true },
      });
      if (!order || (event.milestone !== 'complete' && [4, 5].includes(order.order_status)) || superseded) {
        // Do not replay "driver arrived" after a cancellation/completion or
        // after the customer has already received a newer milestone.
        await prisma.driver_trip_event.update({ where: { id: event.id }, data: { sent_at: new Date(), lease_until: null } });
        continue;
      }
      const payload = { ...event.payload, event_id: String(event.id) };
      // Only the first leased attempt fans out live/WhatsApp events; retries
      // target FCM with the same event id and Android notification tag.
      if (!event.lease_until) {
        try {
          require('../sockets/adminSocket').notifyOrderStatusUpdate({
            id: event.order_id, rid: event.rider_id, city_id: payload.city_id,
            order_status: payload.order_status, o_status: payload.o_status,
          });
          // Preserve the existing WhatsApp lifecycle integrations. Their own
          // helpers handle unavailable sessions; never block push on WhatsApp.
          const whatsapp = require('../whatsapp/notifications');
          if (event.milestone === 'arrived') void Promise.resolve(whatsapp.notifyDriverArrived(event.order_id)).catch(() => {});
          if (event.milestone === 'pickup') void Promise.resolve(whatsapp.notifyTripStarted(event.order_id)).catch(() => {});
          dispatch.emitCustomerEvent(event.user_id, 'order:status_changed', payload);
          dispatch.emitDriverEvent(event.rider_id, 'order:trip_progress', payload);
        } catch (error) { logger.error(`Trip live event ${event.id} failed:`, error); }
      }
      const customer = await prisma.tbl_user.findUnique({ where: { id: event.user_id }, select: { fcm_token: true } });
      const sent = await sendPushNotification(customer?.fcm_token, 'Delivery update', payload.message, {
        type: 'trip_milestone', order_id: String(event.order_id), milestone: event.milestone, event_id: String(event.id),
      });
      if (sent.sent || sent.reason === 'missing_fcm_token') {
        await prisma.driver_trip_event.update({ where: { id: event.id }, data: { sent_at: new Date(), lease_until: null } });
      }
    } catch (error) { logger.error(`Trip event ${event.id} delivery failed:`, error); }
  }
}
async function recordCompletion(order) {
  await prisma.driver_trip_event.upsert({
    where: { order_id_milestone: { order_id: order.id, milestone: 'complete' } }, update: {},
    create: { order_id: order.id, rider_id: order.rid, user_id: order.uid, milestone: 'complete',
      payload: { order_id: order.id, order_status: 5, o_status: 'Completed', city_id: order.city_id,
        message: 'Your delivery is complete. Thank you for choosing Shifter.' } },
  });
  void flushTripEvents().catch(error => logger.error('Completion notification retry pending:', error));
}
module.exports = { flushTripEvents, recordCompletion };
