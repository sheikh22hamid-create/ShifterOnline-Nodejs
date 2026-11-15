const { rcmSummary } = require("../invoiceRcm");

describe("rcmSummary (display only)", () => {
  it("is 5% of the final total fare: Rs 1,000 -> Rs 50", () => {
    expect(rcmSummary(1000, "Completed")).toEqual({ finalTotalFare: 1000, ratePercent: 5, amount: 50 });
  });

  it("rounds to whole paise without float noise", () => {
    expect(rcmSummary(230, "Completed").amount).toBe(11.5);
    expect(rcmSummary(99.99, "Completed").amount).toBe(5);
    expect(rcmSummary(0.1 + 0.2, "Completed").finalTotalFare).toBe(0.3);
    expect(rcmSummary("36.00", "completed").amount).toBe(1.8);
  });

  it.each(["completed", "Completed", " delivered "])("shown for a finished ride (%p)", (status) => {
    expect(rcmSummary(100, status)).not.toBeNull();
  });

  it.each(["Pending", "Processing", "Pickup", "On Route", "Cancelled", "", null, undefined])("no section for %p", (status) => {
    expect(rcmSummary(100, status)).toBeNull();
  });

  it.each([0, -5, null, undefined, "abc", NaN])("no section without a usable fare (%p)", (fare) => {
    expect(rcmSummary(fare, "Completed")).toBeNull();
  });

  it("returns a plain value: nothing to charge, add to the fare or store", () => {
    const out = rcmSummary(1000, "Completed");
    expect(Object.keys(out).sort()).toEqual(["amount", "finalTotalFare", "ratePercent"]);
  });
});
