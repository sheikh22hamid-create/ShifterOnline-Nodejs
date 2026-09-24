jest.mock('../../config/db', () => ({ tbl_rider: { findUnique: jest.fn() } }));
jest.mock('../../services/driverTripService', () => ({ progressTrip: jest.fn() }));
const db = require('../../config/db');
const { progressTrip } = require('../../services/driverTripService');
const { syncProgress } = require('../driverTripController');
let res;
beforeEach(() => {
  jest.clearAllMocks(); res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  db.tbl_rider.findUnique.mockResolvedValue({ device_id: 'registered-device' });
});
test('rejects another device before processing GPS or OTP', async () => {
  await syncProgress({ body: { rider_id: 9, order_id: 7, device_id: 'wrong' } }, res);
  expect(res.status).toHaveBeenCalledWith(403); expect(progressTrip).not.toHaveBeenCalled();
});
test('validates identifiers and propagates transition errors', async () => {
  await syncProgress({ body: { rider_id: -1, order_id: 7 } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  progressTrip.mockRejectedValue(Object.assign(new Error('Invalid pickup OTP'), { statusCode: 409 }));
  await syncProgress({ body: { rider_id: 9, order_id: 7, device_id: 'registered-device', action: 'pickup', otp: '0000' } }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenLastCalledWith({ success: false, message: 'Invalid pickup OTP' });
});
