const { buildCustomerWaitingView } = require("../customerWaitingView");

const NOW = Date.parse("2026-10-04T10:00:00Z");
const base = { order_status: 2, free_waiting_time: "5", wating_charge: "10", d_charge: 200, total_dcharge: 200 };

describe("buildCustomerWaitingView", () => {
  it("exposes free minutes and per-minute rate", () => {
    const v = buildCustomerWaitingView(base, null, NOW);
    expect(v).toMatchObject({ enabled: true, free_waiting_time_minutes: 5, waiting_charge_per_minute: 10, running_since: 0, phase: null });
  });

  it("is disabled when the rate card has no free time and no rate", () => {
    const v = buildCustomerWaitingView({ ...base, free_waiting_time: "0", wating_charge: "0" }, null, NOW);
    expect(v.enabled).toBe(false);
  });

  it("does not run a clock while only waiting for the OTP (not billed)", () => {
    const timer = { pickup_wait_start: new Date(NOW - 120000), pickup_load_wait_start: null, pickup_load_wait_seconds: 0 };
    const v = buildCustomerWaitingView(base, timer, NOW);
    expect(v.running_since).toBe(0);
    expect(v.billable_seconds_banked).toBe(0);
  });

  it("runs the loading clock from OTP entry", () => {
    const start = new Date(NOW - 90000);
    const v = buildCustomerWaitingView(base, { pickup_load_wait_start: start, pickup_load_wait_seconds: 0 }, NOW);
    expect(v.phase).toBe("loading");
    expect(v.running_since).toBe(start.getTime());
  });

  it("banks loading seconds and runs the unloading clock at the drop", () => {
    const drop = new Date(NOW - 30000);
    const v = buildCustomerWaitingView({ ...base, order_status: 3 },
      { pickup_load_wait_seconds: 240, drop_wait_start: drop, drop_wait_end: null }, NOW);
    expect(v.phase).toBe("unloading");
    expect(v.billable_seconds_banked).toBe(240);
    expect(v.running_since).toBe(drop.getTime());
  });

  it("while on the way to the drop, only the banked loading time is reported", () => {
    const v = buildCustomerWaitingView({ ...base, order_status: 3 }, { pickup_load_wait_seconds: 240, drop_wait_start: null }, NOW);
    expect(v.running_since).toBe(0);
    expect(v.billable_seconds_banked).toBe(240);
  });

  it("after completion reports the billed amount and total seconds, with no running clock", () => {
    const v = buildCustomerWaitingView({ ...base, order_status: 5, total_dcharge: 245 },
      { total_wait_seconds: 840, drop_wait_start: new Date(NOW - 1000), drop_wait_end: new Date(NOW) }, NOW);
    expect(v.waiting_charge_billed).toBe(45);
    expect(v.billable_seconds_banked).toBe(840);
    expect(v.running_since).toBe(0);
    expect(v.phase).toBeNull();
  });

  it("billed amount is 0 when nothing was charged", () => {
    expect(buildCustomerWaitingView({ ...base, order_status: 5 }, null, NOW).waiting_charge_billed).toBe(0);
  });
});
