const { getPlanPointRules, computePlanPointUsage } = require("../referralPointRules");

function clientWith(setting) {
  return { tbl_referral_setting: { findFirst: jest.fn().mockResolvedValue(setting) } };
}

describe("getPlanPointRules", () => {
  it("is enabled by default (no settings row) with point value 1 and 100% cap", async () => {
    const rules = await getPlanPointRules(clientWith(null), { referral_enabled: false });
    expect(rules).toEqual({ enabled: true, pointValue: 1, maxPercent: 100 });
  });

  it("does not require the per-plan referral toggle", async () => {
    const rules = await getPlanPointRules(
      clientWith({ referral_enabled: true, plan_purchase_enabled: true, point_value: "2.00", plan_points_max_percent: "50.00" }),
      { referral_enabled: false, referral_point_value: 9 }
    );
    expect(rules).toEqual({ enabled: true, pointValue: 2, maxPercent: 50 });
  });

  it("prefers the plan's own point value when the plan has referral enabled", async () => {
    const rules = await getPlanPointRules(
      clientWith({ referral_enabled: true, plan_purchase_enabled: true, point_value: "1.00", plan_points_max_percent: "100.00" }),
      { referral_enabled: true, referral_point_value: "3.00" }
    );
    expect(rules.pointValue).toBe(3);
  });

  it("is disabled when the program or the plan-purchase switch is off", async () => {
    const programOff = await getPlanPointRules(clientWith({ referral_enabled: false, plan_purchase_enabled: true }), {});
    const switchOff = await getPlanPointRules(clientWith({ referral_enabled: true, plan_purchase_enabled: false }), {});
    expect(programOff.enabled).toBe(false);
    expect(switchOff.enabled).toBe(false);
  });
});

describe("computePlanPointUsage", () => {
  it("covers the whole price when the balance allows", () => {
    expect(computePlanPointUsage({ price: 100, pointValue: 1, maxPercent: 100, available: 500 }))
      .toEqual({ pointsUsable: 100, pointsAmount: 100, payable: 0 });
  });

  it("uses the whole balance when it is below the price", () => {
    expect(computePlanPointUsage({ price: 500, pointValue: 2, maxPercent: 100, available: 100 }))
      .toEqual({ pointsUsable: 100, pointsAmount: 200, payable: 300 });
  });

  it("respects the admin max percent", () => {
    expect(computePlanPointUsage({ price: 200, pointValue: 1, maxPercent: 25, available: 1000 }))
      .toEqual({ pointsUsable: 50, pointsAmount: 50, payable: 150 });
  });

  it("never credits more than the price when a point does not divide it evenly", () => {
    const r = computePlanPointUsage({ price: 100, pointValue: 3, maxPercent: 100, available: 1000 });
    expect(r.pointsUsable).toBe(34);
    expect(r.pointsAmount).toBe(100);
    expect(r.payable).toBe(0);
  });

  it("returns zeros for no points, zero price or zero cap", () => {
    const zero = { pointsUsable: 0, pointsAmount: 0, payable: 100 };
    expect(computePlanPointUsage({ price: 100, pointValue: 1, maxPercent: 100, available: 0 })).toEqual(zero);
    expect(computePlanPointUsage({ price: 100, pointValue: 1, maxPercent: 0, available: 50 })).toEqual(zero);
    expect(computePlanPointUsage({ price: 0, pointValue: 1, maxPercent: 100, available: 50 }))
      .toEqual({ pointsUsable: 0, pointsAmount: 0, payable: 0 });
  });
});

describe("computePlanPointUsage under a partial cap", () => {
  it("rounds down so points x value never exceeds the cap", () => {
    // cap = 50% of 100 = 50; value 3 -> 16 points = 48, not 17 = 51.
    expect(computePlanPointUsage({ price: 100, pointValue: 3, maxPercent: 50, available: 1000 }))
      .toEqual({ pointsUsable: 16, pointsAmount: 48, payable: 52 });
  });
});
