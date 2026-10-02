jest.mock("../../config/db", () => ({ tbl_referral_setting: { findFirst: jest.fn() } }));

const prisma = require("../../config/db");
const { getSettings } = require("../referralController");

function mockRes() {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
}

describe("referralController.getSettings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the stored settings row", async () => {
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ id: 1, ride_discount_percent: 25 });
    const res = mockRes();
    await getSettings({}, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 1, ride_discount_percent: 25 } });
  });

  it("returns editable defaults (not null) when the table has no row yet, so the admin card still renders", async () => {
    prisma.tbl_referral_setting.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await getSettings({}, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data).toMatchObject({ ride_discount_percent: 0, plan_points_max_percent: 100, referral_enabled: true, point_value: 1 });
  });
});
