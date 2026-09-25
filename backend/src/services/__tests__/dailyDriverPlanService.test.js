const { __private } = require("../dailyDriverPlanService");
const { matchesCsvField, hasCapacity } = __private;

describe("dailyDriverPlanService.matchesCsvField (city/vehicle scoping)", () => {
  it("matches everything when the field is 'all'", () => {
    expect(matchesCsvField("all", "Bike")).toBe(true);
    expect(matchesCsvField("all", null)).toBe(true);
  });

  it("matches everything when the field is empty", () => {
    expect(matchesCsvField("", "Bike")).toBe(true);
    expect(matchesCsvField(null, "Bike")).toBe(true);
  });

  it("matches only listed values, case-insensitively", () => {
    expect(matchesCsvField("Bike,Auto", "bike")).toBe(true);
    expect(matchesCsvField("Bike,Auto", "Car")).toBe(false);
  });
});

describe("dailyDriverPlanService.hasCapacity", () => {
  it("allows enrollment while under max_drivers", async () => {
    const mockClient = { daily_driver_enrollment: { count: jest.fn().mockResolvedValue(3) } };
    const plan = { max_drivers: 5 };
    const result = await hasCapacity(1, new Date("2026-09-27"), plan, mockClient);
    expect(result).toBe(true);
  });

  it("blocks enrollment once max_drivers is reached", async () => {
    const mockClient = { daily_driver_enrollment: { count: jest.fn().mockResolvedValue(5) } };
    const plan = { max_drivers: 5 };
    const result = await hasCapacity(1, new Date("2026-09-27"), plan, mockClient);
    expect(result).toBe(false);
  });
});
