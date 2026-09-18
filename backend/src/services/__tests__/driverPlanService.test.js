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

describe("driver plan minimum ride guarantee", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 5);
  const future = new Date();
  future.setDate(future.getDate() + 15);

  it("keeps subscription active past end_date if guaranteed rides are not met", async () => {
    const mockClient = {
      tbl_user_plan_subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 101,
            user_id: 1,
            plan_id: 1,
            status: "active",
            start_date: new Date(2025, 0, 1),
            end_date: yesterday, // Expired date
            guaranteed_target: 20,
            rides_completed: 15, // 5 rides remaining
          },
        ]),
      },
      tbl_premium_plan: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, plan_name: "Guaranteed Plan", plan_type: "DRIVER_PREMIUM", priority_enabled: true },
        ]),
      },
    };

    const active = await __private.activeSubscriptions(1, mockClient);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(101);
  });

  it("filters out expired subscription past end_date when guaranteed rides are already fulfilled", async () => {
    const mockClient = {
      tbl_user_plan_subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 102,
            user_id: 1,
            plan_id: 1,
            status: "active",
            start_date: new Date(2025, 0, 1),
            end_date: yesterday, // Expired date
            guaranteed_target: 20,
            rides_completed: 20, // All 20 rides completed!
          },
        ]),
      },
      tbl_premium_plan: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const active = await __private.activeSubscriptions(1, mockClient);
    expect(active.length).toBe(0);
  });

  it("formats buildPlanPayload with min_ride_guarantee and extension state", () => {
    const plan = {
      id: 5,
      plan_name: "20 Rides Guaranteed Plan",
      plan_type: "DRIVER_PREMIUM",
      validity_days: 30,
      price: "499",
      commission_percent: "5",
      per_trip_charge: "0",
      min_ride_guarantee_enabled: true,
      min_ride_guarantee: 20,
    };

    const activeSub = {
      id: 50,
      plan_id: 5,
      rides_completed: 16,
      guaranteed_target: 20,
      end_date: yesterday, // past validity
    };

    const payload = __private.buildPlanPayload(plan, [activeSub], 0);
    expect(payload.min_ride_guarantee).toEqual({
      enabled: true,
      target_rides: 20,
      rides_completed: 16,
      rides_remaining: 4,
      is_extended: true,
    });
    expect(payload.ui_tags).toContain("Min 20 rides guaranteed");
    expect(payload.validity_label).toBe("Extended (4 rides left)");
  });

  it("expires extended subscription upon completing target ride after end_date", async () => {
    const driverPlanService = require("../driverPlanService");
    const mockUpdate = jest.fn().mockResolvedValue({});
    const mockCreateLog = jest.fn().mockResolvedValue({});
    const mockClient = {
      tbl_user_plan_subscription: { update: mockUpdate },
      tbl_plan_benefit_log: { create: mockCreateLog },
      tbl_rider: { update: jest.fn() },
      tbl_wallet_history: { create: jest.fn() },
    };

    const chosenBenefit = {
      benefit: 5,
      incentive: 0,
      planType: "DRIVER_PREMIUM",
      commissionPercent: 5,
      subscription: {
        id: 77,
        end_date: yesterday, // past end date
        guaranteed_target: 20,
        rides_completed: 19, // this ride will be 20th!
      },
      plan: {
        id: 5,
        plan_name: "Guaranteed Plan",
      },
    };

    await driverPlanService.recordCompletedRide({
      driverId: 1,
      orderId: 999,
      fare: 100,
      baseCommissionPercent: 10,
      chosenBenefit,
      client: mockClient,
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 77 },
        data: expect.objectContaining({
          rides_completed: { increment: 1 },
          status: "expired",
        }),
      })
    );
  });

  it("does NOT expire subscription upon completing target ride if still within validity duration", async () => {
    const driverPlanService = require("../driverPlanService");
    const mockUpdate = jest.fn().mockResolvedValue({});
    const mockCreateLog = jest.fn().mockResolvedValue({});
    const mockClient = {
      tbl_user_plan_subscription: { update: mockUpdate },
      tbl_plan_benefit_log: { create: mockCreateLog },
      tbl_rider: { update: jest.fn() },
      tbl_wallet_history: { create: jest.fn() },
    };

    const chosenBenefit = {
      benefit: 5,
      incentive: 0,
      planType: "DRIVER_PREMIUM",
      commissionPercent: 5,
      subscription: {
        id: 88,
        end_date: future, // still 15 days left!
        guaranteed_target: 20,
        rides_completed: 19, // this ride will be 20th
      },
      plan: {
        id: 5,
        plan_name: "Guaranteed Plan",
      },
    };

    await driverPlanService.recordCompletedRide({
      driverId: 1,
      orderId: 1000,
      fare: 100,
      baseCommissionPercent: 10,
      chosenBenefit,
      client: mockClient,
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 88 },
        data: expect.not.objectContaining({
          status: "expired",
        }),
      })
    );
  });
});

describe("driver plan package category filtering", () => {
  const { matchesPackageCategory } = __private;

  it("allows all vehicles when plan package_categories is 'all', null, or empty", () => {
    expect(matchesPackageCategory("all", "Bike", 1)).toBe(true);
    expect(matchesPackageCategory(null, "Bike", 1)).toBe(true);
    expect(matchesPackageCategory("", "Auto", 2)).toBe(true);
    expect(matchesPackageCategory("*", "Tata Ace", 3)).toBe(true);
  });

  it("matches category by exact vehicle name (case-insensitive)", () => {
    expect(matchesPackageCategory("Bike,Auto", "bike", 1)).toBe(true);
    expect(matchesPackageCategory("Bike,Auto", "AUTO", 2)).toBe(true);
    expect(matchesPackageCategory("Bike", "Tata Ace", 3)).toBe(false);
  });

  it("matches category by category ID", () => {
    expect(matchesPackageCategory("1,2", "Unknown Vehicle", 1)).toBe(true);
    expect(matchesPackageCategory("1,2", "Unknown Vehicle", 2)).toBe(true);
    expect(matchesPackageCategory("1,2", "Unknown Vehicle", 3)).toBe(false);
  });

  it("includes package_categories and vehicle tag in buildPlanPayload", () => {
    const plan = {
      id: 10,
      plan_name: "Bike Rider Saver",
      plan_type: "DRIVER_PREMIUM",
      validity_days: 30,
      price: "199",
      commission_percent: "5",
      package_categories: "Bike",
    };
    const payload = __private.buildPlanPayload(plan, [], 0);
    expect(payload.package_categories).toBe("Bike");
    expect(payload.ui_tags).toContain("Vehicle: Bike");
  });
});
