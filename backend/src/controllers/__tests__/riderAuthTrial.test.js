jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_personal_doc: { findFirst: jest.fn().mockResolvedValue(null) },
}));
jest.mock("../../services/otpService", () => ({
  normalizeMobile: jest.fn((m) => m),
  isValidIndianMobile: jest.fn(() => true),
  verifyOtp: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock("../../services/deviceSessionService", () => ({
  registerDevice: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../utils/driverVerificationSettings", () => ({
  getAutoVerificationSettings: jest.fn().mockResolvedValue({ charge: 0, chargeOld: 0, msg: "" }),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn() }));

const prisma = require("../../config/db");
const { verifyOtp } = require("../riderAuthController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("riderAuthController.verifyOtp includes trial fields for existing drivers", () => {
  afterEach(() => jest.clearAllMocks());

  it("passes trial_status/trial_orders_allowed/trial_orders_completed through to DriverData", async () => {
    const driverRow = {
      id: 4, full_name: "Raju", fmobile: "9998887777", verification_status: "pending",
      payment_complete: 0, status: 1, reffer_code: "REF1",
      trial_status: "active", trial_orders_allowed: 5, trial_orders_completed: 2,
    };
    prisma.tbl_rider.findFirst.mockResolvedValue(driverRow);
    // charge is mocked to 0 above, so verifyOtp auto-resolves payment_complete
    // and re-fetches the driver row via findUnique - keep it consistent.
    prisma.tbl_rider.findUnique.mockResolvedValue({ ...driverRow, payment_complete: 1 });
    const res = makeRes();
    await verifyOtp({ body: { mobile: "9998887777", otp: "0000" } }, res);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.DriverData).toEqual(expect.objectContaining({
      trial_status: "active", trial_orders_allowed: 5, trial_orders_completed: 2,
    }));
  });
});
