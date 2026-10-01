const { istNow, formatLedgerTime } = require("../istTime");

describe("formatLedgerTime", () => {
  it("renders the stored wall clock without any timezone shift", () => {
    expect(formatLedgerTime(new Date("2026-10-01T15:38:59.000Z"))).toBe("2026-10-01 15:38:59");
  });

  it("round-trips an istNow() value as IST wall-clock", () => {
    const written = istNow();
    const istClock = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16).replace("T", " ");
    expect(formatLedgerTime(written).slice(0, 16)).toBe(istClock);
  });

  it("passes null/invalid through", () => {
    expect(formatLedgerTime(null)).toBeNull();
    expect(formatLedgerTime("garbage")).toBe("garbage");
  });
});
