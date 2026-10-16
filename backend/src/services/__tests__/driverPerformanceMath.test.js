const { computeRates, statusForScore } = require("../driverPerformanceMath");

describe("driverPerformanceMath.computeRates", () => {
  test("computes each rate against the right denominator", () => {
    const r = computeRates({ offered: 10, accepted: 8, rejected: 1, skipped: 1, completed: 6 });
    expect(r.acceptanceRate).toBe(80);
    expect(r.completionRate).toBe(75); // completed / accepted
    expect(r.rejectionRate).toBe(10);
    expect(r.skipRate).toBe(10);
    // 0.4*80 + 0.4*75 + 0.2*(100-20) = 32 + 30 + 16
    expect(r.score).toBe(78);
    expect(r.status).toBe("Good");
  });

  test("a perfect driver is Excellent", () => {
    const r = computeRates({ offered: 5, accepted: 5, rejected: 0, skipped: 0, completed: 5 });
    expect(r.score).toBe(100);
    expect(r.status).toBe("Excellent");
  });

  test("no offers at all gives no rates and 'No data'", () => {
    const r = computeRates({ offered: 0, accepted: 0, rejected: 0, skipped: 0, completed: 0 });
    expect(r.acceptanceRate).toBeNull();
    expect(r.completionRate).toBeNull();
    expect(r.score).toBeNull();
    expect(r.status).toBe("No data");
  });

  test("offered but never accepted scores completion as 0 and lands in Poor", () => {
    const r = computeRates({ offered: 4, accepted: 0, rejected: 2, skipped: 2, completed: 0 });
    expect(r.completionRate).toBeNull();
    expect(r.score).toBe(0);
    expect(r.status).toBe("Poor");
  });

  test("a rate never exceeds 100 even if events are out of step", () => {
    const r = computeRates({ offered: 2, accepted: 3, rejected: 0, skipped: 0, completed: 5 });
    expect(r.acceptanceRate).toBe(100);
    expect(r.completionRate).toBe(100);
  });

  test("status bands", () => {
    expect(statusForScore(85)).toBe("Excellent");
    expect(statusForScore(84.9)).toBe("Good");
    expect(statusForScore(70)).toBe("Good");
    expect(statusForScore(50)).toBe("Average");
    expect(statusForScore(49.9)).toBe("Poor");
    expect(statusForScore(null)).toBe("No data");
  });
});
