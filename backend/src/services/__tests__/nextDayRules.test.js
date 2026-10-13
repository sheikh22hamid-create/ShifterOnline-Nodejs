const rules = require("../nextDayRules");

describe("splitDailyDriverFare", () => {
  it("gives the Daily Driver 90% and records the 10% difference", () => {
    expect(rules.splitDailyDriverFare(100)).toEqual({ driverEarning: 90, discount: 10 });
  });
  it("rounds to 2 decimals and the two parts always add up to the fare", () => {
    const { driverEarning, discount } = rules.splitDailyDriverFare(133.37);
    expect(driverEarning).toBe(120.03);
    expect(Math.round((driverEarning + discount) * 100) / 100).toBe(133.37);
  });
  it("uses the admin-set discount percent when given", () => {
    expect(rules.splitDailyDriverFare(100, 20)).toEqual({ driverEarning: 80, discount: 20 });
    expect(rules.splitDailyDriverFare(100, 0)).toEqual({ driverEarning: 100, discount: 0 });
    expect(rules.splitDailyDriverFare(200, 7.5)).toEqual({ driverEarning: 185, discount: 15 });
  });
  it("falls back to the default 10% for a missing or invalid percent", () => {
    for (const p of [undefined, null, "abc", -5, 80]) expect(rules.splitDailyDriverFare(100, p)).toEqual({ driverEarning: 90, discount: 10 });
  });
  it("treats a bad fare as zero", () => {
    expect(rules.splitDailyDriverFare("abc")).toEqual({ driverEarning: 0, discount: 0 });
  });
});

describe("parseLiveTime", () => {
  it("accepts HH:MM", () => expect(rules.parseLiveTime("13:30")).toBe("13:30"));
  it("falls back to 14:00 for junk", () => {
    for (const v of [undefined, null, "", "2pm", "25:00", "14:60"]) expect(rules.parseLiveTime(v)).toBe("14:00");
  });
});

describe("liveAtFor", () => {
  it("is the IST wall time on the trip date, as a UTC instant", () => {
    expect(rules.liveAtFor("2026-10-13", "14:00").toISOString()).toBe("2026-10-13T08:30:00.000Z");
  });
  it("returns null for an unusable date", () => {
    expect(rules.liveAtFor("not-a-date", "14:00")).toBeNull();
  });
});

describe("rankByPickupDistance", () => {
  const order = { plat: "22.7196", plong: "75.8577" };
  it("orders nearest first and puts riders without a location last", () => {
    const riders = [
      { id: 1, rlats: "22.80", rlongs: "75.90" },
      { id: 2, rlats: null, rlongs: null },
      { id: 3, rlats: "22.72", rlongs: "75.86" },
    ];
    expect(rules.rankByPickupDistance(order, riders).map((r) => r.id)).toEqual([3, 1, 2]);
  });
});
