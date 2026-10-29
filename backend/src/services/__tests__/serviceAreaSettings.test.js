jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../serviceAreaSettings");

beforeEach(() => jest.resetAllMocks());

describe("isEnforced", () => {
  it.each([[null, false], [{ setting_value: "" }, false], [{ setting_value: "0" }, false], [{ setting_value: "1" }, true], [{ setting_value: "On" }, true]])(
    "setting %j -> %s", async (row, expected) => {
      prisma.app_settings.findFirst.mockResolvedValue(row);
      expect(await settings.isEnforced()).toBe(expected);
    },
  );
  it("stays off when the setting cannot be read", async () => {
    prisma.app_settings.findFirst.mockRejectedValue(new Error("db"));
    expect(await settings.isEnforced()).toBe(false);
  });
});
