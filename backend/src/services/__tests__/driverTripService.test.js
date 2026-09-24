jest.mock('../../config/db', () => ({
  $transaction: jest.fn(), $queryRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  driver_trip_progress: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  driver_trip_event: { upsert: jest.fn() },
}));
jest.mock('../tripEventNotifier', () => ({ flushTripEvents: jest.fn().mockResolvedValue() }));
const db = require('../../config/db');
const { progressTrip } = require('../driverTripService');
let order, progress, timer, stops;
const now = Date.parse('2026-09-24T10:00:00Z');
const call = (action = 'sync', extra = {}) => progressTrip({ orderId: 7, riderId: 9, action, ...extra });
beforeEach(() => {
  jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now);
  order = { id: 7, uid: 8, rid: 9, order_status: 1, o_status: 'Processing', otp: 1234, plat: '28.6', plong: '77.2', dlat: '28.7', dlong: '77.3', payment_status: 1 };
  progress = null; timer = null; stops = [];
  db.$transaction.mockImplementation(fn => fn(db));
  db.pkg_order.findUnique.mockImplementation(async () => ({ ...order }));
  db.pkg_order.update.mockImplementation(async ({ data }) => Object.assign(order, data));
  db.pkg_order_stops.findMany.mockImplementation(async () => stops);
  db.driver_trip_progress.findUnique.mockImplementation(async () => progress && ({ ...progress }));
  db.driver_trip_progress.create.mockImplementation(async ({ data }) => progress = { ...data, stop_step: 0, candidate_count: 0 });
  db.driver_trip_progress.update.mockImplementation(async ({ data }) => progress = { ...progress, ...data, updated_at: new Date(now) });
  db.pkg_order_wait_timer.findUnique.mockImplementation(async () => timer);
  db.pkg_order_wait_timer.upsert.mockImplementation(async ({ create, update }) => timer = timer ? { ...timer, ...update } : create);
  db.pkg_order_wait_timer.update.mockImplementation(async ({ data }) => timer = { ...timer, ...data });
});
afterEach(() => jest.restoreAllMocks());
test('auto arrival persists exactly one milestone and retry does not reset timer', async () => {
  const samples = [0, 10000, 20000, 30000].map(t => ({ timestamp: now - 30000 + t, lat: 28.6, lng: 77.2, accuracy: 10, speed: 0 }));
  expect((await call('sync', { samples })).driver_flow_id).toBe(2);
  const start = timer.pickup_wait_start;
  await call('sync', { samples }); await call('arrived');
  expect(timer.pickup_wait_start).toEqual(start);
  expect(db.driver_trip_event.upsert).toHaveBeenCalledTimes(1);
  expect(db.$queryRaw).toHaveBeenCalled();
});
test('correct OTP starts pickup atomically; incorrect or missing OTP cannot', async () => {
  await call('arrived');
  await expect(call('pickup')).rejects.toThrow('OTP');
  await expect(call('pickup', { otp: '0000' })).rejects.toThrow('Invalid');
  expect(order.order_status).toBe(2);
  expect((await call('pickup', { otp: '1234' })).driver_flow_id).toBe(3);
  await call('pickup', { otp: '1234' });
  expect(db.driver_trip_event.upsert).toHaveBeenCalledTimes(2);
});
test('does not skip pickup arrival or pending payment', async () => {
  await expect(call('pickup', { otp: '1234' })).rejects.toThrow('arrival');
  order.advance_payment = '20'; order.payment_status = 0;
  await expect(call('arrived')).rejects.toThrow('advance payment');
  expect((await call()).driver_flow_id).toBe(1);
});
test('stop order is enforced, stop and drop arrival survive reload', async () => {
  await call('arrived'); await call('pickup', { otp: '1234' });
  stops = [{ lat: '28.65', lng: '77.25' }];
  await expect(call('arrived_drop')).rejects.toThrow('stop');
  await expect(call('complete_stop_1')).rejects.toThrow('arrival');
  await call('arrived_stop_1'); await call('complete_stop_1'); await call('complete_stop_1');
  expect(progress.stop_step).toBe(2);
  await call('arrived_drop');
  expect(order.order_status).toBe(3); // 4 is cancellation in the global API!
  expect((await call()).driver_flow_id).toBe(4);
  expect((await call()).stop_step).toBe(3);
  expect(timer.drop_wait_start).toBeTruthy();
});
test('wrong rider and cancelled trip cannot advance', async () => {
  await expect(progressTrip({ orderId: 7, riderId: 55, action: 'arrived' })).rejects.toThrow('assigned');
  order.order_status = 4;
  await expect(call('arrived')).rejects.toThrow('no longer active');
  expect((await call()).active).toBe(false);
});
test('automatically arrives at the active stop before the final drop', async () => {
  order.order_status = 3; order.o_status = 'On_Route';
  order.pickup_time = new Date(now - 60000);
  stops = [{ lat: '28.65', lng: '77.25' }];
  const fixes = (lat, lng) => [0, 10000, 20000, 30000].map(t => ({ timestamp: now - 30000 + t, lat, lng, accuracy: 10, speed: 0 }));
  await call('sync', { samples: fixes(28.7, 77.3) });
  expect(progress.stop_step).toBe(0); // Passing the final drop cannot skip stop 1.
  progress.last_sample_at = new Date(now - 40000);
  expect((await call('sync', { samples: fixes(28.65, 77.25) })).stop_step).toBe(1);
  await call('complete_stop_1');
  progress.last_sample_at = new Date(now - 40000);
  const result = await call('sync', { samples: fixes(28.7, 77.3) });
  expect(result.driver_flow_id).toBe(4);
  expect(result.stop_step).toBe(3);
  expect(timer.drop_wait_start).toEqual(new Date(now));
});
test('malformed observations are rejected without writing trip state', async () => {
  await expect(call('sync', { samples: [null] })).rejects.toThrow('valid location');
  expect(db.$transaction).not.toHaveBeenCalled();
});
