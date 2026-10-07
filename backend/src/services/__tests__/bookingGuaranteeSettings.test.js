jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn(), upsert: jest.fn() },
}));

const prisma = require("../../config/db");
const settings = require("../bookingGuaranteeSettings");

beforeEach(() => jest.clearAllMocks());

describe("getAssignWindowMinutes", () => {
  it("falls back to the default (10) when unset", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await settings.getAssignWindowMinutes()).toBe(10);
  });
  it("reads a stored value", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "15" });
    expect(await settings.getAssignWindowMinutes()).toBe(15);
  });
  it("ignores a corrupt or non-positive stored value", async () => {
    for (const bad of ["abc", "0", "-5", ""]) {
      prisma.app_settings.findFirst.mockResolvedValue({ setting_value: bad });
      expect(await settings.getAssignWindowMinutes()).toBe(10);
    }
  });
});

describe("setAssignWindowMinutes", () => {
  it("stores a valid integer", async () => {
    prisma.app_settings.upsert.mockResolvedValue({});
    expect(await settings.setAssignWindowMinutes("20")).toBe(20);
    expect(prisma.app_settings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { setting_key: "booking_guarantee_assign_minutes" },
      update: expect.objectContaining({ setting_value: "20" }),
    }));
  });
  it.each([0, -1, 1.5, "abc", 1441, null, undefined])("rejects %p with a 400", async (bad) => {
    await expect(settings.setAssignWindowMinutes(bad)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
  });
});
