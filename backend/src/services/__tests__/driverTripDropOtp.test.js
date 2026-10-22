jest.mock('../../config/db', () => ({
  $transaction: jest.fn(), $queryRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  driver_trip_progress: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  driver_trip_event: { upsert: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() },
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
    ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0, autoCompleteDistanceM: 150, autoPauseDistanceM: 500,
  }),
}));
jest.mock('../../utils/pickupOtpTimeout', () => ({
  getPickupOtpTimeoutMinutes: jest.fn().mockResolvedValue(10),
}));
const db = require('../../config/db');
const { progressTrip, snapshot } = require('../driverTripService');
const dropOtp = require('../dropOtp');
let order, progress, timer, stops, pauseEvent;
const now = Date.parse('2026-09-24T10:00:00Z');
const call = (action = 'sync', extra = {}) => progressTrip({ orderId: 7, riderId: 9, action, ...extra });
beforeEach(() => {
  jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now);
  order = { id: 7, uid: 8, rid: 9, order_status: 1, o_status: 'Processing', otp: 1234, plat: '28.6', plong: '77.2', dlat: '28.7', dlong: '77.3', payment_status: 1 };
  progress = null; timer = null; stops = []; pauseEvent = null;
  order.drop_otp = 5678;
  db.app_settings.findFirst.mockResolvedValue({ setting_value: '1' });
  db.driver_trip_event.findUnique.mockImplementation(async () => pauseEvent);
  db.driver_trip_event.upsert.mockImplementation(async ({ where, create, update }) => { if (where.order_id_milestone.milestone === 'pickup_timer_paused') pauseEvent = { payload: (update && update.payload) || create.payload }; });
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
// Drop OTP (moved 2026-10-22): arrival and the unloading/waiting timer are unchanged; the OTP is asked when the
// driver completes the trip (tripLifecycle.updateStatus, covered in tripLifecycle.test.js and dropOtp.test.js).
const reachDrop = async () => {
  await call('arrived'); await call('pickup', { otp: '1234' });
  await call('arrived_drop');
};
test('arriving at the drop starts the unloading timer as usual, even when a drop OTP is required', async () => {
  await reachDrop();
  expect(order.order_status).toBe(3);
  expect(timer.drop_arrived_at).toBeTruthy();
  expect(timer.drop_wait_start).toBeTruthy();
  const snap = await call();
  expect(snap.drop_otp_required).toBe(true);
  expect(snap.drop_otp_pending).toBeUndefined();
  expect(snap.driver_flow_id).toBe(4);
});
test('the arrival notice tells the receiver to share the OTP for completion, not for unloading', async () => {
  await reachDrop();
  const created = db.driver_trip_event.upsert.mock.calls.map(c => c[0].create).filter(Boolean).find(c => c.milestone === 'arrived_drop');
  expect(created.payload.message).toContain('drop OTP');
  expect(created.payload.message).toContain('complete the delivery');
});
test('the old verify_drop_otp step no longer exists', async () => {
  await reachDrop();
  await expect(call('verify_drop_otp', { otp: '5678' })).rejects.toThrow('Unsupported trip action');
});
test('with intermediate stops the drop arrival still comes after the last stop and starts the timer', async () => {
  await call('arrived'); await call('pickup', { otp: '1234' });
  stops = [{ lat: '28.65', lng: '77.25' }];
  await call('arrived_stop_1'); await call('complete_stop_1');
  expect(timer.drop_wait_start).toBeFalsy();
  await call('arrived_drop');
  expect(timer.drop_wait_start).toBeTruthy();
});
test('an order without a drop OTP behaves the same: arrival starts the unloading timer, no OTP is required', async () => {
  order.drop_otp = null;
  await reachDrop();
  expect(timer.drop_wait_start).toBeTruthy();
  const snap = await call();
  expect(snap.drop_otp_required).toBe(false);
  expect(snap.driver_flow_id).toBe(4);
});
test('switching the feature OFF stops requiring the OTP', async () => {
  await reachDrop();
  db.app_settings.findFirst.mockResolvedValue({ setting_value: '0' });
  await dropOtp.isEnabled({ fresh: true });
  expect(await dropOtp.isRequired(order)).toBe(false);
});
