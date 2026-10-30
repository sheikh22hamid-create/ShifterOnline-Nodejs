const r = require("../pointsExpiryRules");

const at = (s) => new Date(s);
const credit = (id, points, expires, created, activity = "successful_referral") => ({ id, points, activity, expires_at: expires ? at(expires) : null, created_at: at(created) });
const debit = (id, points, created, origin = null) => ({ id, points: -points, origin_log_id: origin, created_at: at(created) });

describe("duration config", () => {
  test("accepts days, weeks and months", () => {
    expect(r.parseDuration({ value: 60, unit: "days" })).toEqual({ value: 60, unit: "days" });
    expect(r.parseDuration({ value: 2, unit: "WEEKS" })).toEqual({ value: 2, unit: "weeks" });
    expect(r.parseDuration({ value: 3, unit: "months" })).toEqual({ value: 3, unit: "months" });
  });
  test("empty means never expires", () => {
    expect(r.parseDuration(null)).toBeNull();
    expect(r.parseDuration("")).toBeNull();
  });
  test.each([[{ value: 0, unit: "days" }], [{ value: -5, unit: "days" }], [{ value: 1.5, unit: "days" }], [{ value: "abc", unit: "days" }], [{ value: 3, unit: "years" }], [{ value: 3 }], [{ value: 9999, unit: "days" }]])("rejects %j", (bad) => {
    expect(() => r.parseDuration(bad)).toThrow();
  });
  test("saving Customer never overwrites Driver", () => {
    const existing = { successful_referral: { DRIVER: { value: 30, unit: "days" } } };
    const out = r.mergeConfig(existing, { successful_referral: { USER: { value: 3, unit: "months" } } });
    expect(out.successful_referral).toEqual({ DRIVER: { value: 30, unit: "days" }, USER: { value: 3, unit: "months" } });
  });
  test("null clears one row only", () => {
    const existing = { number_sharing: { USER: { value: 1, unit: "months" }, DRIVER: { value: 2, unit: "months" } } };
    expect(r.mergeConfig(existing, { number_sharing: { USER: null } }).number_sharing).toEqual({ DRIVER: { value: 2, unit: "months" } });
  });
  test("rejects unknown activity / user type and does not mutate the original", () => {
    const existing = { successful_referral: { USER: { value: 3, unit: "months" } } };
    expect(() => r.mergeConfig(existing, { bonus: { USER: { value: 1, unit: "days" } } })).toThrow(/Unknown reward activity/);
    expect(() => r.mergeConfig(existing, { successful_referral: { ADMIN: { value: 1, unit: "days" } } })).toThrow(/Unknown user type/);
    expect(existing.successful_referral.USER.value).toBe(3);
  });
  test("an unset row has no duration (no default invented)", () => {
    expect(r.durationFor({}, "successful_referral", "USER")).toBeNull();
    expect(r.durationFor(null, "number_sharing", "DRIVER")).toBeNull();
  });
});

describe("expiry date", () => {
  test("10 Jan + 3 months = 10 Apr", () => {
    expect(r.addDuration(at("2027-01-10T08:00:00Z"), { value: 3, unit: "months" }).toISOString()).toBe("2027-04-10T08:00:00.000Z");
  });
  test("31 Jan + 1 month clamps to the last day of February", () => {
    expect(r.addDuration(at("2027-01-31T08:00:00Z"), { value: 1, unit: "months" }).toISOString()).toBe("2027-02-28T08:00:00.000Z");
  });
  test("days and weeks", () => {
    expect(r.addDuration(at("2027-01-10T00:00:00Z"), { value: 60, unit: "days" }).toISOString()).toBe("2027-03-11T00:00:00.000Z");
    expect(r.addDuration(at("2027-01-10T00:00:00Z"), { value: 2, unit: "weeks" }).toISOString()).toBe("2027-01-24T00:00:00.000Z");
  });
  test("description shows the expiry date; no expiry part when it never expires", () => {
    expect(r.describeCredit("successful_referral", 100, at("2027-04-10T08:00:00Z"))).toBe("Successful Referral: +100 points | Expires on: 10 Apr 2027");
    expect(r.describeCredit("number_sharing", 20, null)).toBe("Number Sharing: +20 points");
  });
});

describe("replayLots", () => {
  test("100 credited, 40 redeemed before expiry: 60 remain", () => {
    const lots = r.replayLots([credit(1, 100, "2027-04-10T00:00:00Z", "2027-01-10T00:00:00Z"), debit(2, 40, "2027-02-01T00:00:00Z")]);
    expect(lots.get(1).remaining).toBe(60);
  });
  test("a redemption consumes the soonest-expiring lot first", () => {
    const lots = r.replayLots([
      credit(1, 50, "2027-06-01T00:00:00Z", "2027-01-01T00:00:00Z"),
      credit(2, 50, "2027-03-01T00:00:00Z", "2027-01-02T00:00:00Z"),
      credit(3, 50, null, "2027-01-03T00:00:00Z"),
      debit(4, 60, "2027-01-10T00:00:00Z"),
    ]);
    expect(lots.get(2).remaining).toBe(0);
    expect(lots.get(1).remaining).toBe(40);
    expect(lots.get(3).remaining).toBe(50);
  });
  test("a redemption after a lot expired does not touch the expired lot", () => {
    const lots = r.replayLots([
      credit(1, 50, "2027-02-01T00:00:00Z", "2027-01-01T00:00:00Z"),
      credit(2, 50, null, "2027-01-02T00:00:00Z"),
      debit(3, 30, "2027-02-15T00:00:00Z"),
    ]);
    expect(lots.get(1).remaining).toBe(50); // still waiting to be expired
    expect(lots.get(2).remaining).toBe(20);
  });
  test("an expiry row reduces only its own lot", () => {
    const lots = r.replayLots([
      credit(1, 100, "2027-04-10T00:00:00Z", "2027-01-10T00:00:00Z"),
      debit(2, 40, "2027-02-01T00:00:00Z"),
      debit(3, 60, "2027-04-10T01:00:00Z", 1),
      credit(4, 20, null, "2027-04-11T00:00:00Z"),
    ]);
    expect(lots.get(1).remaining).toBe(0);
    expect(lots.get(4).remaining).toBe(20);
  });
  test("a debit larger than the ledger explains is ignored, never negative", () => {
    const lots = r.replayLots([credit(1, 10, null, "2027-01-01T00:00:00Z"), debit(2, 500, "2027-01-02T00:00:00Z")]);
    expect(lots.get(1).remaining).toBe(0);
  });
});

describe("refunds restore the lots they were taken from", () => {
  const refund = (id, points, created) => ({ id, points, source: "ride_discount_refund", created_at: at(created) });

  test("redeem then cancel: the points are expiring again, not a free non-expiring lot", () => {
    const lots = r.replayLots([
      credit(1, 100, "2027-04-10T00:00:00Z", "2027-01-10T00:00:00Z"),
      debit(2, 40, "2027-02-01T00:00:00Z"),
      refund(3, 40, "2027-02-02T00:00:00Z"),
    ]);
    expect(lots.get(1).remaining).toBe(100);
    expect(lots.has(3)).toBe(false);
  });
  test("a refund after the original lot expired opens a fresh lot (the ride was real when the points were spent)", () => {
    const lots = r.replayLots([
      credit(1, 100, "2027-02-01T00:00:00Z", "2027-01-10T00:00:00Z"),
      debit(2, 40, "2027-01-20T00:00:00Z"),
      refund(3, 40, "2027-03-01T00:00:00Z"),
    ]);
    expect(lots.get(1).remaining).toBe(60);
    expect(lots.get(3)).toMatchObject({ remaining: 40, expires_at: null });
  });
  test("a refund bigger than the tracked redemptions restores those and opens a lot for the rest", () => {
    const lots = r.replayLots([credit(1, 100, "2027-04-10T00:00:00Z", "2027-01-10T00:00:00Z"), debit(2, 10, "2027-02-01T00:00:00Z"), refund(3, 25, "2027-02-02T00:00:00Z")]);
    expect(lots.get(1).remaining).toBe(100);
    expect(lots.get(3).remaining).toBe(15);
  });
  test("a non-refund credit never restores anything", () => {
    const lots = r.replayLots([credit(1, 100, "2027-04-10T00:00:00Z", "2027-01-10T00:00:00Z"), debit(2, 40, "2027-02-01T00:00:00Z"), { id: 3, points: 40, source: "admin_adjustment", created_at: at("2027-02-02T00:00:00Z") }]);
    expect(lots.get(1).remaining).toBe(60);
    expect(lots.get(3).remaining).toBe(40);
  });
});
