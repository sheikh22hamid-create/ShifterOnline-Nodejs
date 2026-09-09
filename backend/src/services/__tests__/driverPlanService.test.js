const { __private } = require("../driverPlanService");

function subscription({ id = 1, planType = "DRIVER_PREMIUM", commission = 5, perTrip = 0, incentive = 0 }) {
  return {
    id,
    plan_snapshot: JSON.stringify({ commission_percent: commission, per_trip_charge: perTrip, incentive_enabled: incentive > 0, incentive_type: "flat", incentive_value: incentive }),
    incentive_earned: 0,
    tbl_premium_plan: {
      id, plan_type: planType, guaranteed_enabled: planType === "DRIVER_SECOND",
      commission_percent: commission, per_trip_charge: perTrip, incentive_enabled: incentive > 0,
      incentive_type: "flat", incentive_value: incentive, incentive_min_fare: 0, incentive_monthly_cap: 0,
      priority_enabled: false,
    },
  };
}

describe("driver premium benefit selection", () => {
  it("calculates benefit against the base rate-card deduction", () => {
    const result = __private.candidateForFare(subscription({ commission: 5, perTrip: 2 }), 100, 12, 0);
    expect(result.deduction).toBe(7);
    expect(result.benefit).toBe(5);
  });

  it("includes an eligible incentive when comparing plans", () => {
    const result = __private.candidateForFare(subscription({ commission: 8, incentive: 5 }), 100, 12, 0);
    expect(result.deduction).toBe(3);
    expect(result.benefit).toBe(9);
  });

  it("never treats a worse plan as a driver benefit", () => {
    const result = __private.candidateForFare(subscription({ commission: 20, perTrip: 10 }), 100, 12, 0);
    expect(result.benefit).toBe(0);
  });
});
