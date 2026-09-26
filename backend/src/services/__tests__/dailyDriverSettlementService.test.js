const { __private } = require("../dailyDriverSettlementService");
const { computeSettlement } = __private;

function plan(overrides = {}) {
  return {
    price: 1400,
    required_duty_hours: 10,
    free_km: 100,
    extra_km_rate: 10,
    shortfall_hourly_rate: 160,
    overtime_hourly_rate: 100,
    ...overrides,
  };
}

describe("dailyDriverSettlementService.computeSettlement", () => {
  it("pays proportionally for actual duty hours out of the required hours (8/10 hrs -> 8/10 of price)", () => {
    const result = computeSettlement({
      ridesCompleted: 3,
      actualKm: 78,
      rideEarnings: 850,
      dutyHoursCounted: 8,
      plan: plan(),
    });

    // price=1400, required=10h -> 140/hr; 8h worked -> 1120, not 1400 minus a shortfall charge.
    expect(result.shortfallHours).toBe(2);
    expect(result.shortfallDeduction).toBe(280);
    expect(result.eligiblePlanAmount).toBe(1120);
    expect(result.settlementDirection).toBe("company_pays");
    expect(result.finalSettlementAmount).toBe(270);
  });

  it("zero rides forfeits the entire plan amount regardless of online hours (spec section 17)", () => {
    const result = computeSettlement({
      ridesCompleted: 0,
      actualKm: 0,
      rideEarnings: 0,
      dutyHoursCounted: 9, // stayed online 9/10 hours, but zero rides
      plan: plan(),
    });

    expect(result.eligiblePlanAmount).toBe(0);
    expect(result.shortfallDeduction).toBe(0); // shortfall math never runs for zero rides
    expect(result.settlementDirection).toBe("none");
    expect(result.finalSettlementAmount).toBe(0);
  });

  it("retains the excess for the company when ride earnings exceed the eligible plan amount", () => {
    const result = computeSettlement({
      ridesCompleted: 5,
      actualKm: 100,
      rideEarnings: 1600,
      dutyHoursCounted: 10,
      plan: plan(),
    });

    expect(result.eligiblePlanAmount).toBe(1400);
    expect(result.settlementDirection).toBe("company_retains");
    expect(result.finalSettlementAmount).toBe(200);
  });

  it("charges extra KM beyond the plan's free KM allowance", () => {
    const result = computeSettlement({
      ridesCompleted: 2,
      actualKm: 130,
      rideEarnings: 500,
      dutyHoursCounted: 10,
      plan: plan({ free_km: 100, extra_km_rate: 10 }),
    });

    expect(result.extraKm).toBe(30);
    expect(result.extraKmCharge).toBe(300);
  });

  it("pays overtime for hours worked beyond the required duty hours", () => {
    const result = computeSettlement({
      ridesCompleted: 4,
      actualKm: 90,
      rideEarnings: 900,
      dutyHoursCounted: 12,
      plan: plan({ required_duty_hours: 10, overtime_hourly_rate: 100 }),
    });

    expect(result.overtimeHours).toBe(2);
    expect(result.overtimePay).toBe(200);
    expect(result.shortfallHours).toBe(0);
    expect(result.shortfallDeduction).toBe(0);
  });

  it("never lets the shortfall deduction push the eligible amount below zero", () => {
    const result = computeSettlement({
      ridesCompleted: 1,
      actualKm: 5,
      rideEarnings: 50,
      dutyHoursCounted: 0, // fully offline all day but got exactly one ride in
      plan: plan({ price: 200, shortfall_hourly_rate: 160, required_duty_hours: 10 }),
    });

    // 10 hrs shortfall * 160 = 1600, far more than the 200 plan price
    expect(result.eligiblePlanAmount).toBe(0);
  });

  it("exactly meeting required hours produces zero shortfall and zero overtime", () => {
    const result = computeSettlement({
      ridesCompleted: 1,
      actualKm: 50,
      rideEarnings: 1400,
      dutyHoursCounted: 10,
      plan: plan(),
    });

    expect(result.shortfallHours).toBe(0);
    expect(result.overtimeHours).toBe(0);
    expect(result.eligiblePlanAmount).toBe(1400);
    expect(result.settlementDirection).toBe("none");
  });
});
