jest.mock('../../config/db', () => ({
  $transaction: jest.fn(), $queryRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  driver_trip_progress: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  driver_trip_event: { upsert: jest.fn() },
}));
jest.mock('../tripEventNotifier', () => ({ flushTripEvents: jest.fn().mockResolvedValue() }));
jest.mock('../pricingEngine', () => ({
  priceForPackageId: jest.fn().mockResolvedValue({ fare: 300, driverEarning: 270, commission: 30 }),
}));
jest.mock('../orderRouteRepricing', () => ({
  getDriverRealDistanceKm: jest.fn().mockResolvedValue(1),
  computeRouteDistanceKm: jest.fn().mockResolvedValue(12.5),
}));
jest.mock('../../utils/pickupRelocateSettings', () => ({
  getPickupRelocateSettings: jest.fn().mockResolvedValue({
    ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
  }),
}));
jest.mock('../../utils/pickupOtpTimeout', () => ({
  getPickupOtpTimeoutMinutes: jest.fn().mockResolvedValue(10),
}));
const db = require('../../config/db');
const { progressTrip, snapshot } = require('../driverTripService');
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
test('first arrival stamps first_arrival_at once; later pauses/re-arrivals never overwrite it', async () => {
  const samples = [0, 10000, 20000, 30000].map(t => ({ timestamp: now - 30000 + t, lat: 28.6, lng: 77.2, accuracy: 10, speed: 0 }));
  await call('sync', { samples });
  const firstStamp = timer.first_arrival_at;
  expect(firstStamp).toBeTruthy();

  // Simulate a pickup-change revert (Task 4/5's territory) clearing pickup_wait_start
  // but NOT first_arrival_at, then a second arrival at a new point.
  timer.pickup_wait_start = null;
  order.order_status = 1;
  await call('sync', { samples });
  expect(timer.first_arrival_at).toEqual(firstStamp);
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
test('OTP verified far from the confirmed pickup reprices the trip and sets the mismatch flag', async () => {
  const pricingEngine = require('../pricingEngine');
  await call('arrived');
  // order.plat/plong are '28.6'/'77.2' (from beforeEach); ~1.1km away.
  await call('pickup', { otp: '1234', lat: 28.61, lng: 77.2 });

  expect(pricingEngine.priceForPackageId).toHaveBeenCalled();
  expect(order.plat).toBe('28.61');
  expect(order.plong).toBe('77.2');
  expect(order.pickup_otp_mismatch_flag).toBe(true);
  expect(order.d_charge).toBe(300);
});

test('OTP-mismatch reprice preserves the accept-time radius amount baked into d_charge (not zeroed by the OTP-point distance)', async () => {
  const pricingEngine = require('../pricingEngine');
  // Accept-time d_charge 300 at 10km = bare zero-radius fare 250 + 50 radius.
  Object.assign(order, { distance: 10, d_charge: 300, total_dcharge: 300, driver_earning: 300, commission: 12.5 });
  pricingEngine.priceForPackageId.mockImplementation(async (pid, distanceKm) => (
    distanceKm === 12.5 ? { fare: 280, driverEarning: 250, commission: 10.71 } : { fare: 250, driverEarning: 225, commission: 10 }
  ));
  await call('arrived');
  await call('pickup', { otp: '1234', lat: 28.61, lng: 77.2 });

  // Both reprices are zero-radius (radiusRangeKm = 1): old distance, then new.
  expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(1, 10, 1, 0, 8);
  expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(1, 12.5, 1, 0, 8);
  expect(order.d_charge).toBe(330); // 280 new bare fare + 50 preserved, not just 280
  expect(order.total_dcharge).toBe(330);
});

test('OTP-mismatch reprice keeps the order\'s own commission split (commission is a %, driver_earning is the gross fare)', async () => {
  const pricingEngine = require('../pricingEngine');
  Object.assign(order, { distance: 10, d_charge: 300, total_dcharge: 300, driver_earning: 300, commission: 12.5 });
  pricingEngine.priceForPackageId.mockImplementation(async (pid, distanceKm) => (
    distanceKm === 12.5 ? { fare: 280, driverEarning: 250, commission: 10.71 } : { fare: 250, driverEarning: 225, commission: 10 }
  ));
  await call('arrived');
  await call('pickup', { otp: '1234', lat: 28.61, lng: 77.2 });

  expect(order.commission).toBe(12.5); // this order's existing percentage, unchanged
  expect(order.driver_earning).toBe(order.d_charge); // finalizeAcceptedOrder's invariant
});

test('OTP verified near the confirmed pickup does not reprice or flag', async () => {
  const pricingEngine = require('../pricingEngine');
  await call('arrived');
  // ~10m away - well under the 500m default threshold.
  await call('pickup', { otp: '1234', lat: 28.6001, lng: 77.2 });

  expect(pricingEngine.priceForPackageId).not.toHaveBeenCalled();
  expect(order.pickup_otp_mismatch_flag).toBeFalsy();
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
test('OTP countdown subtracts pickup_wait_banked_seconds (time already waited before a large-move pause)', async () => {
  const waitingOrder = { ...order, order_status: 2, o_status: 'Pickup' };
  // 2 min since re-arrival + 3 min banked from before the pause = 5 of 10 min used.
  const banked = await snapshot(waitingOrder, null, { pickup_wait_start: new Date(now - 120000), pickup_wait_end: null, pickup_wait_banked_seconds: 180 }, 0);
  expect(banked.pickup_otp_remaining_seconds).toBe(300);
  // Nothing banked -> only the 2 min since arrival counts.
  const fresh = await snapshot(waitingOrder, null, { pickup_wait_start: new Date(now - 120000), pickup_wait_end: null, pickup_wait_banked_seconds: 0 }, 0);
  expect(fresh.pickup_otp_remaining_seconds).toBe(480);
});
test('malformed observations are rejected without writing trip state', async () => {
  await expect(call('sync', { samples: [null] })).rejects.toThrow('valid location');
  expect(db.$transaction).not.toHaveBeenCalled();
});
