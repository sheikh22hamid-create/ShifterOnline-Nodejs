jest.mock("../../config/db", () => ({}));
jest.mock("../../utils/advancePaymentTimer", () => ({ getAdvancePaymentTimerInfo: () => ({ is_advance_required: false, remaining_seconds: 0 }) }));
const { formatPkgOrderForDriver } = require("../driverOrderHistoryController");
const context = { stopsByOrder: {}, benefitByOrder: {}, planNameCache: {}, globalComm: 10 };
describe("driver earnings timestamps", () => {
  it("returns the completion wall clock with IST offset and actual UTC trip duration", () => {
    const trip = formatPkgOrderForDriver({ id: 1, o_status: "Completed", payment_status: 1,
      pickup_time: new Date("2026-09-21T12:00:00Z"), drop_time: new Date("2026-09-21T18:39:00Z"),
      total_dcharge: 359, driver_earning: 312.33, category: "3 Wheeler" }, context);
    expect(trip.earnings_completed_at).toBe("2026-09-21T18:39:00.000+05:30");
    expect(trip.trip_duration_minutes).toBe(69);
    expect(trip.vehicle_category).toBe("3 Wheeler");
  });
  describe("cash the driver collects nets off referral-points and coupon discounts", () => {
    const base = { id: 3, o_status: "Processing", payment_status: 1, total_dcharge: 200, advance_payment: "15", category: "Bike" };

    it("subtracts the referral-points discount (platform absorbs it) from cash_to_collect", () => {
      const trip = formatPkgOrderForDriver({ ...base, referral_points_amount: "30" }, context);
      expect(trip.cash_to_collect).toBe(155); // 200 - 15 advance - 30 points
      expect(trip.cash_collected_from_user).toBe(155);
      expect(trip.trip_payment_summary.payment_by_user.cash_to_collect).toBe(155);
    });

    it("subtracts the coupon discount as well, matching tripLifecycle's prepaidTotal", () => {
      const trip = formatPkgOrderForDriver({ ...base, referral_points_amount: "30", cou_amt: "20" }, context);
      expect(trip.cash_to_collect).toBe(135);
    });

    it("never goes below zero when discounts cover the whole fare", () => {
      const trip = formatPkgOrderForDriver({ ...base, total_dcharge: 40, referral_points_amount: "30" }, context);
      expect(trip.cash_to_collect).toBe(0);
    });

    it("is unchanged for an order with no discounts", () => {
      expect(formatPkgOrderForDriver(base, context).cash_to_collect).toBe(185);
    });
  });

  describe("top-level extra_waiting_time_charge (completed-ride popup)", () => {
    it("is the billed amount (total_dcharge - d_charge), not the per-minute rate", () => {
      const trip = formatPkgOrderForDriver({ id: 4, o_status: "Completed", payment_status: 1,
        d_charge: 200, total_dcharge: 245, wating_charge: "10", free_waiting_time: "5" }, context);
      expect(trip.extra_waiting_time_charge).toBe(45);
      expect(trip.wating_charge).toBe("10");
      expect(trip.trip_payment_summary.fare_breakdown.extra_waiting_time_charge).toBe(45);
    });

    it("is 0 (not null) when no waiting charge was billed", () => {
      const trip = formatPkgOrderForDriver({ id: 5, o_status: "Completed", payment_status: 1,
        d_charge: 200, total_dcharge: 200, wating_charge: "10" }, context);
      expect(trip.extra_waiting_time_charge).toBe(0);
    });
  });

  it("does not turn missing or inconsistent old timings into fake zero-hour trips", () => {
    expect(formatPkgOrderForDriver({ id: 2, o_status: "Completed", payment_status: 1 }, context).trip_duration_minutes).toBeNull();
    expect(formatPkgOrderForDriver({ id: 2, o_status: "Cancelled", payment_status: 1 }, context).earnings_completed_at).toBeNull();
  });
});
