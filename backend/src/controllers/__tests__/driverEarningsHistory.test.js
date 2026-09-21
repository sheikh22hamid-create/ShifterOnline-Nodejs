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
  it("does not turn missing or inconsistent old timings into fake zero-hour trips", () => {
    expect(formatPkgOrderForDriver({ id: 2, o_status: "Completed", payment_status: 1 }, context).trip_duration_minutes).toBeNull();
    expect(formatPkgOrderForDriver({ id: 2, o_status: "Cancelled", payment_status: 1 }, context).earnings_completed_at).toBeNull();
  });
});
