jest.mock("../../config/db", () => ({
  customise_order: { findUnique: jest.fn() },
  customise_order_timer: { upsert: jest.fn() },
  customise_event: { create: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const timers = require("../customiseTimerService");

const CO = { p_wait_min: 10, p_load_min: 30, d_wait_min: 5, d_unload_min: 20 };
const T0 = new Date("2026-10-27T10:00:00Z");
const END = new Date("2026-10-27T13:00:00Z");
const TIMER = { pickup_wait_start: T0, pickup_wait_end: new Date("2026-10-27T10:08:00Z"), pickup_wait_seconds: 480, otp_verify_at: new Date("2026-10-27T10:08:00Z"), pickup_load_wait_seconds: 1500, drop_wait_start: new Date("2026-10-27T12:00:00Z") };
const bySeg = (list) => Object.fromEntries(list.map((s) => [s.segment, s]));

beforeEach(() => jest.resetAllMocks());

describe("segmentsOf", () => {
  it("charges nothing when each activity stays within the customer's selected minutes", () => {
    const s = bySeg(timers.segmentsOf({ co: CO, waitTimer: TIMER, dropWaitSeconds: 25 * 60, rate: 2, endedAt: END }));
    expect(s.pickup_wait).toMatchObject({ selected_min: 10, elapsed_seconds: 480, billed_seconds: 0, charge: 0 });
    expect(s.pickup_load).toMatchObject({ selected_min: 30, elapsed_seconds: 1500, billed_seconds: 0, charge: 0 });
    expect(s.drop).toMatchObject({ selected_min: 25, elapsed_seconds: 1500, billed_seconds: 0, charge: 0 });
  });

  it("charges exactly the seconds beyond the allowance at the per-minute rate", () => {
    const s = bySeg(timers.segmentsOf({ co: CO, waitTimer: { ...TIMER, pickup_wait_seconds: 10 * 60 + 1, pickup_load_wait_seconds: 40 * 60 }, dropWaitSeconds: 25 * 60 + 90, rate: 2, endedAt: END }));
    expect(s.pickup_wait).toMatchObject({ billed_seconds: 1, charge: 0.03 });
    expect(s.pickup_load).toMatchObject({ billed_seconds: 600, charge: 20 });
    expect(s.drop).toMatchObject({ billed_seconds: 90, charge: 3 });
  });

  it("bills a segment the customer left at 0 minutes from its first second", () => {
    const s = bySeg(timers.segmentsOf({ co: { ...CO, p_load_min: 0 }, waitTimer: TIMER, dropWaitSeconds: 0, rate: 3, endedAt: END }));
    expect(s.pickup_load).toMatchObject({ selected_min: 0, billed_seconds: 1500, charge: 75 });
  });

  it("treats a missing wait-timer row as zero everywhere (never NaN)", () => {
    const list = timers.segmentsOf({ co: CO, waitTimer: null, dropWaitSeconds: 0, rate: 2, endedAt: END });
    expect(list.map((x) => x.charge)).toEqual([0, 0, 0]);
    list.forEach((x) => expect(Number.isFinite(x.elapsed_seconds)).toBe(true));
  });

  it("records the actual start and end of each activity", () => {
    const s = bySeg(timers.segmentsOf({ co: CO, waitTimer: TIMER, dropWaitSeconds: 600, rate: 2, endedAt: END }));
    expect(s.pickup_wait.started_at).toEqual(T0);
    expect(s.pickup_wait.ended_at).toEqual(TIMER.pickup_wait_end);
    expect(s.pickup_load.started_at).toEqual(TIMER.otp_verify_at);
    expect(s.pickup_load.ended_at).toEqual(new Date(TIMER.otp_verify_at.getTime() + 1500 * 1000));
    expect(s.drop.started_at).toEqual(TIMER.drop_wait_start);
    expect(s.drop.ended_at).toEqual(END);
  });
});

describe("billFor", () => {
  it("is null for a normal ride", async () => {
    expect(await timers.billFor({ id: 1, customise_order_id: null }, TIMER, 0)).toBeNull();
    expect(prisma.customise_order.findUnique).not.toHaveBeenCalled();
  });

  it("is null (caller keeps the normal formula) when the Customise order cannot be read", async () => {
    prisma.customise_order.findUnique.mockRejectedValue(new Error("db"));
    expect(await timers.billFor({ id: 1, customise_order_id: 5, wating_charge: "2" }, TIMER, 0)).toBeNull();
    prisma.customise_order.findUnique.mockResolvedValue(null);
    expect(await timers.billFor({ id: 1, customise_order_id: 5, wating_charge: "2" }, TIMER, 0)).toBeNull();
  });

  it("totals the segment charges using the ride's waiting rate", async () => {
    prisma.customise_order.findUnique.mockResolvedValue(CO);
    const out = await timers.billFor({ id: 1, customise_order_id: 5, wating_charge: "2" }, { ...TIMER, pickup_load_wait_seconds: 40 * 60 }, 25 * 60, END);
    expect(out.total).toBe(20);
    expect(out.segments).toHaveLength(3);
  });
});

describe("record", () => {
  it("upserts one row per segment, so a recompute never doubles a charge", async () => {
    const segs = timers.segmentsOf({ co: CO, waitTimer: TIMER, dropWaitSeconds: 0, rate: 2, endedAt: END });
    await timers.record(7, segs);
    expect(prisma.customise_order_timer.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.customise_order_timer.upsert.mock.calls[0][0].where).toEqual({ order_id_segment: { order_id: 7, segment: "pickup_wait" } });
    expect(prisma.customise_event.create.mock.calls[0][0].data).toMatchObject({ order_id: 7, type: "timers_charged" });
  });

  it("never throws when the audit write fails", async () => {
    prisma.customise_order_timer.upsert.mockRejectedValue(new Error("db"));
    await expect(timers.record(7, timers.segmentsOf({ co: CO, waitTimer: TIMER, dropWaitSeconds: 0, rate: 2, endedAt: END }))).resolves.toBeUndefined();
  });
});
