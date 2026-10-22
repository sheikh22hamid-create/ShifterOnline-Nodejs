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
