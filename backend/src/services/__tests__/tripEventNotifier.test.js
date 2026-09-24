jest.mock('../../config/db', () => ({
  driver_trip_event: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));
jest.mock('../../config/firebase', () => ({ sendPushNotification: jest.fn() }));
jest.mock('../dispatchManager', () => ({ emitCustomerEvent: jest.fn(), emitDriverEvent: jest.fn() }));
jest.mock('../../sockets/adminSocket', () => ({ notifyOrderStatusUpdate: jest.fn() }));
jest.mock('../../whatsapp/notifications', () => ({ notifyDriverArrived: jest.fn(), notifyTripStarted: jest.fn() }));
const db = require('../../config/db');
const { sendPushNotification } = require('../../config/firebase');
const dispatch = require('../dispatchManager');
const { flushTripEvents } = require('../tripEventNotifier');
beforeEach(() => {
  jest.clearAllMocks();
  db.driver_trip_event.findMany.mockResolvedValue([{ id: 1, order_id: 7, user_id: 8, rider_id: 9, milestone: 'arrived', payload: { message: 'Driver arrived' } }]);
  db.driver_trip_event.updateMany.mockResolvedValue({ count: 1 });
  db.tbl_user.findUnique.mockResolvedValue({ fcm_token: 'test-token' });
  db.pkg_order.findUnique.mockResolvedValue({ order_status: 2 });
  db.driver_trip_event.findFirst.mockResolvedValue(null);
});
test('emits socket update and push with stable event identity, then acknowledges', async () => {
  sendPushNotification.mockResolvedValue({ sent: true });
  await flushTripEvents();
  expect(dispatch.emitCustomerEvent).toHaveBeenCalledWith(8, 'order:status_changed', expect.objectContaining({ event_id: '1' }));
  expect(sendPushNotification).toHaveBeenCalledWith('test-token', expect.any(String), 'Driver arrived', expect.objectContaining({ event_id: '1', milestone: 'arrived' }));
  expect(db.driver_trip_event.update).toHaveBeenCalled();
});
test('failed push remains pending for retry after lease expiry', async () => {
  sendPushNotification.mockResolvedValue({ sent: false, reason: 'network' });
  await flushTripEvents();
  expect(db.driver_trip_event.update).not.toHaveBeenCalled();
});
test('another worker holding the lease prevents duplicate sends', async () => {
  db.driver_trip_event.updateMany.mockResolvedValue({ count: 0 });
  await flushTripEvents();
  expect(sendPushNotification).not.toHaveBeenCalled();
});
test('does not deliver a stale arrival after the trip is closed', async () => {
  db.pkg_order.findUnique.mockResolvedValue({ order_status: 5 });
  await flushTripEvents();
  expect(sendPushNotification).not.toHaveBeenCalled();
  expect(db.driver_trip_event.update).toHaveBeenCalled();
});
