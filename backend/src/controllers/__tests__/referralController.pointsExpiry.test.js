jest.mock("../../config/db", () => ({
  tbl_referral_setting: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
}));

const prisma = require("../../config/db");
const { updateSettings, getSettings } = require("../referralController");

const mockRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const saved = { id: 1, points_expiry: { successful_referral: { DRIVER: { value: 30, unit: "days" } } } };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tbl_referral_setting.findFirst.mockResolvedValue(saved);
  prisma.tbl_referral_setting.update.mockImplementation(async ({ data }) => ({ ...saved, ...data }));
});

describe("updateSettings: points expiry", () => {
  test("saves a valid duration and keeps the other user type's row", async () => {
    const res = mockRes();
    await updateSettings({ body: { points_expiry: { successful_referral: { USER: { value: 3, unit: "months" } } } } }, res);
    const data = prisma.tbl_referral_setting.update.mock.calls[0][0].data;
    expect(data.points_expiry.successful_referral).toEqual({ DRIVER: { value: 30, unit: "days" }, USER: { value: 3, unit: "months" } });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test.each([
    [{ successful_referral: { USER: { value: -1, unit: "days" } } }],
    [{ successful_referral: { USER: { value: 0, unit: "days" } } }],
    [{ successful_referral: { USER: { value: 3, unit: "years" } } }],
    [{ nope: { USER: { value: 3, unit: "days" } } }],
    [{ number_sharing: { ADMIN: { value: 3, unit: "days" } } }],
  ])("rejects %j without saving", async (bad) => {
    const res = mockRes();
    await updateSettings({ body: { points_expiry: bad } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_referral_setting.update).not.toHaveBeenCalled();
  });

  test("a save that does not mention expiry leaves it alone", async () => {
    await updateSettings({ body: { user_point: 50 } }, mockRes());
    expect(prisma.tbl_referral_setting.update.mock.calls[0][0].data).not.toHaveProperty("points_expiry");
  });
});

describe("getSettings: points expiry", () => {
  test("returns the saved config and lists every row with no duration set", async () => {
    const res = mockRes();
    await getSettings({}, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data.points_expiry).toEqual(saved.points_expiry);
    expect(data.points_expiry_unset).toHaveLength(5); // 3 activities x 2 user types, minus the one that is set
    expect(data.points_expiry_unset).not.toContainEqual({ activity: "successful_referral", user_type: "DRIVER" });
  });
});
