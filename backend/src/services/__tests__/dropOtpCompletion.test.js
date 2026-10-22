jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
const prisma = require("../../config/db");
const dropOtp = require("../dropOtp");

async function setSwitch(value) {
  prisma.app_settings.findFirst.mockResolvedValue(value === null ? null : { setting_value: value });
  await dropOtp.isEnabled({ fresh: true });
}

describe("dropOtp.completionRefusal", () => {
  const order = { id: 1, drop_otp: 4321 };
  beforeEach(() => dropOtp.resetAttempts());

  it("allows completion when the switch is OFF or the order has no OTP", async () => {
    await setSwitch("0");
    expect(await dropOtp.completionRefusal(order, undefined)).toBeNull();
    await setSwitch("1");
    expect(await dropOtp.completionRefusal({ id: 1, drop_otp: null }, undefined)).toBeNull();
  });

  it("asks for the OTP when it is missing or blank", async () => {
    await setSwitch("1");
    for (const v of [undefined, null, "", "  "]) {
      expect(await dropOtp.completionRefusal(order, v)).toMatchObject({ drop_otp_required: true, drop_otp_invalid: false });
    }
  });

  it("rejects a wrong OTP and accepts the right one (string or number, surrounding spaces ignored)", async () => {
    await setSwitch("1");
    expect(await dropOtp.completionRefusal(order, "1111")).toMatchObject({ drop_otp_required: true, drop_otp_invalid: true, msg: "Invalid drop OTP" });
    expect(await dropOtp.completionRefusal(order, "4321")).toBeNull();
    expect(await dropOtp.completionRefusal(order, 4321)).toBeNull();
    expect(await dropOtp.completionRefusal(order, " 4321 ")).toBeNull();
  });
});

describe("dropOtp brute-force limit", () => {
  const order = { id: 2, drop_otp: 4321 };
  let now;
  beforeEach(async () => {
    dropOtp.resetAttempts();
    now = Date.parse("2026-10-22T10:00:00Z");
    jest.spyOn(Date, "now").mockImplementation(() => now);
    await setSwitch("1");
  });
  afterEach(() => jest.restoreAllMocks());

  const wrongTries = async (n) => { for (let i = 0; i < n; i++) await dropOtp.completionRefusal(order, "0000"); };

  it("locks the order after the allowed wrong attempts, even for the correct OTP", async () => {
    await wrongTries(dropOtp.MAX_WRONG_ATTEMPTS);
    const locked = await dropOtp.completionRefusal(order, "4321");
    expect(locked).toMatchObject({ drop_otp_required: true, drop_otp_locked: true });
    expect(locked.retry_after_seconds).toBeGreaterThan(0);
  });

  it("allows a retry once the cool-down has passed", async () => {
    await wrongTries(dropOtp.MAX_WRONG_ATTEMPTS);
    now += dropOtp.LOCK_MS + 1000;
    expect(await dropOtp.completionRefusal(order, "4321")).toBeNull();
  });

  it("does not lock on a few honest typos, and the correct OTP clears the count", async () => {
    await wrongTries(dropOtp.MAX_WRONG_ATTEMPTS - 1);
    expect(await dropOtp.completionRefusal(order, "4321")).toBeNull();
    await wrongTries(dropOtp.MAX_WRONG_ATTEMPTS - 1);
    expect(await dropOtp.completionRefusal(order, "4321")).toBeNull();
  });

  it("counts attempts per order", async () => {
    await wrongTries(dropOtp.MAX_WRONG_ATTEMPTS);
    expect(await dropOtp.completionRefusal({ id: 3, drop_otp: 4321 }, "4321")).toBeNull();
  });
});
