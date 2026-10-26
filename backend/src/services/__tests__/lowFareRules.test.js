const rules = require("../lowFareRules");

const CFG = { discountPercent: 20, maxDaysAhead: 7, maxWindowHours: 12 };
// 2026-10-27 10:00 IST
const NOW = new Date("2026-10-27T04:30:00Z");

describe("validateWindow", () => {
  it("returns the UTC instants of the window, read as IST wall clock", () => {
    const out = rules.validateWindow({ date: "2026-10-28", from: "14:00", until: "16:00" }, NOW, CFG);
    expect(out).toEqual({ ok: true, liveAt: new Date("2026-10-28T08:30:00Z"), liveUntil: new Date("2026-10-28T10:30:00Z") });
  });

  it("accepts a window ending exactly at the maximum length", () => {
    expect(rules.validateWindow({ date: "2026-10-28", from: "08:00", until: "20:00" }, NOW, CFG).ok).toBe(true);
  });

  it.each([
    [{ date: "2026-10-27", from: "14:00", until: "16:00" }, "Choose a date from tomorrow onwards"],
    [{ date: "2026-10-26", from: "14:00", until: "16:00" }, "Choose a date from tomorrow onwards"],
    [{ date: "2026-11-04", from: "14:00", until: "16:00" }, "You can book at most 7 days ahead"],
    [{ date: "2026-10-28", from: "16:00", until: "16:00" }, "End time must be after the start time"],
    [{ date: "2026-10-28", from: "16:00", until: "14:00" }, "End time must be after the start time"],
    [{ date: "2026-10-28", from: "06:00", until: "19:00" }, "The time window cannot be longer than 12 hours"],
    [{ date: "28-10-2026", from: "14:00", until: "16:00" }, "Choose a valid date"],
    [{ date: "2026-10-28", from: "2pm", until: "16:00" }, "Choose a valid start time"],
    [{ date: "2026-10-28", from: "14:00", until: "25:00" }, "Choose a valid end time"],
    [undefined, "Choose a valid date"],
  ])("rejects %j with a plain message", (input, error) => {
    expect(rules.validateWindow(input, NOW, CFG)).toEqual({ ok: false, error });
  });

  it("allows tomorrow at the last day of the allowed range (boundary)", () => {
    expect(rules.validateWindow({ date: "2026-11-03", from: "10:00", until: "12:00" }, NOW, CFG).ok).toBe(true);
  });

  it("uses IST for what today is: just after midnight IST is already the next day", () => {
    const justAfterMidnightIst = new Date("2026-10-26T18:31:00Z"); // 2026-10-27 00:01 IST
    expect(rules.validateWindow({ date: "2026-10-27", from: "14:00", until: "16:00" }, justAfterMidnightIst, CFG).ok).toBe(false);
    expect(rules.validateWindow({ date: "2026-10-28", from: "14:00", until: "16:00" }, justAfterMidnightIst, CFG).ok).toBe(true);
  });
});

describe("discountedFare", () => {
  it("is the Model-1 fare minus the percentage", () => {
    expect(rules.discountedFare(1000, 20)).toEqual({ discounted: 800, discountAmount: 200 });
  });
  it("rounds to 2 decimals and the parts add up", () => {
    const out = rules.discountedFare(333.33, 12.5);
    expect(out.discountAmount).toBe(41.67);
    expect(out.discounted).toBe(291.66);
    expect(out.discounted + out.discountAmount).toBeCloseTo(333.33, 10);
  });
  it("clamps the percentage to 0..50 and never goes negative or NaN", () => {
    expect(rules.discountedFare(1000, 90)).toEqual({ discounted: 500, discountAmount: 500 });
    expect(rules.discountedFare(1000, -5)).toEqual({ discounted: 1000, discountAmount: 0 });
    expect(rules.discountedFare(undefined, 20)).toEqual({ discounted: 0, discountAmount: 0 });
    expect(rules.discountedFare(1000, "x")).toEqual({ discounted: 1000, discountAmount: 0 });
  });
});

describe("isOpenNow", () => {
  const order = { next_day_stage: "low_fare", next_day_live_at: new Date("2026-10-28T08:30:00Z"), next_day_live_until: new Date("2026-10-28T10:30:00Z") };
  it("is open from the start up to, but not including, the end", () => {
    expect(rules.isOpenNow(order, new Date("2026-10-28T08:29:59Z"))).toBe(false);
    expect(rules.isOpenNow(order, new Date("2026-10-28T08:30:00Z"))).toBe(true);
    expect(rules.isOpenNow(order, new Date("2026-10-28T10:29:59Z"))).toBe(true);
    expect(rules.isOpenNow(order, new Date("2026-10-28T10:30:00Z"))).toBe(false);
  });
  it("is never open for another stage or a missing window", () => {
    expect(rules.isOpenNow({ ...order, next_day_stage: "arranging" }, new Date("2026-10-28T09:00:00Z"))).toBe(false);
    expect(rules.isOpenNow({ ...order, next_day_live_until: null }, new Date("2026-10-28T09:00:00Z"))).toBe(false);
  });
});
