jest.mock("../../config/db", () => ({
  customise_order: { findUnique: jest.fn() },
  customise_order_stop: { findMany: jest.fn() },
  driver_trip_event: { findMany: jest.fn() },
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

beforeEach(() => {
  jest.resetAllMocks();
  prisma.customise_order_stop.findMany.mockResolvedValue([]);
  prisma.driver_trip_event.findMany.mockResolvedValue([]);
});

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

describe("stopSegmentsOf", () => {
  const STOPS = [
    { seq: 1, wait_min: 2, load_min: 5, unload_min: 3 },
    { seq: 2, wait_min: 0, load_min: 10, unload_min: 0 },
  ];
  const at = (hhmmss) => new Date(`2026-10-27T${hhmmss}Z`);
  const ev = (milestone, hhmmss) => ({ milestone, created_at: at(hhmmss) });
  const bySeg2 = (list) => Object.fromEntries(list.map((x) => [x.segment, x]));

  it("allows the stop's own waiting + loading + unloading minutes and charges nothing within them", () => {
    const out = bySeg2(timers.stopSegmentsOf({ stops: STOPS, events: [ev("arrived_stop_1", "10:00:00"), ev("complete_stop_1", "10:10:00")], rate: 2 }));
    expect(out.stop_1).toMatchObject({ selected_min: 10, elapsed_seconds: 600, billed_seconds: 0, charge: 0 });
    expect(out.stop_1.started_at).toEqual(at("10:00:00"));
    expect(out.stop_1.ended_at).toEqual(at("10:10:00"));
  });

  it("charges exactly the seconds beyond the allowance", () => {
    const out = bySeg2(timers.stopSegmentsOf({ stops: STOPS, events: [ev("arrived_stop_1", "10:00:00"), ev("complete_stop_1", "10:11:30")], rate: 2 }));
    expect(out.stop_1).toMatchObject({ billed_seconds: 90, charge: 3 });
  });

  it("bills each stop on its own", () => {
    const out = bySeg2(timers.stopSegmentsOf({
      stops: STOPS,
      events: [ev("arrived_stop_1", "10:00:00"), ev("complete_stop_1", "10:10:00"), ev("arrived_stop_2", "10:30:00"), ev("complete_stop_2", "10:50:00")],
      rate: 3,
    }));
    expect(out.stop_1.charge).toBe(0);
    expect(out.stop_2).toMatchObject({ selected_min: 10, elapsed_seconds: 1200, billed_seconds: 600, charge: 30 });
  });

  it("does not bill a stop whose arrival or completion was never recorded, or that completes before it arrives", () => {
    const list = timers.stopSegmentsOf({
      stops: [...STOPS, { seq: 3, wait_min: 0, load_min: 0, unload_min: 0 }],
      events: [ev("arrived_stop_1", "10:00:00"), ev("complete_stop_2", "10:50:00"), ev("arrived_stop_3", "11:00:00"), ev("complete_stop_3", "10:00:00")],
      rate: 2,
    });
    expect(list).toEqual([]);
  });
});

describe("billFor with stops", () => {
  it("adds each billed stop to the total and the segment list", async () => {
    prisma.customise_order.findUnique.mockResolvedValue(CO);
    prisma.customise_order_stop.findMany.mockResolvedValue([{ seq: 1, wait_min: 0, load_min: 5, unload_min: 0 }]);
    prisma.driver_trip_event.findMany.mockResolvedValue([
      { milestone: "arrived_stop_1", created_at: new Date("2026-10-27T10:00:00Z") },
      { milestone: "complete_stop_1", created_at: new Date("2026-10-27T10:15:00Z") },
    ]);
    const out = await timers.billFor({ id: 9, customise_order_id: 5, wating_charge: "2" }, { ...TIMER, pickup_load_wait_seconds: 40 * 60 }, 25 * 60, END);
    expect(out.segments.map((x) => x.segment)).toEqual(["pickup_wait", "pickup_load", "drop", "stop_1"]);
    expect(out.total).toBe(40); // pickup_load 20 + stop_1 (10 min over x 2)
    expect(prisma.driver_trip_event.findMany).toHaveBeenCalledWith({
      where: { order_id: 9, milestone: { in: ["arrived_stop_1", "complete_stop_1"] } }, select: { milestone: true, created_at: true },
    });
  });

  it("still bills pickup and drop when the stop events cannot be read", async () => {
    prisma.customise_order.findUnique.mockResolvedValue(CO);
    prisma.customise_order_stop.findMany.mockRejectedValue(new Error("db"));
    const out = await timers.billFor({ id: 9, customise_order_id: 5, wating_charge: "2" }, { ...TIMER, pickup_load_wait_seconds: 40 * 60 }, 25 * 60, END);
    expect(out.total).toBe(20);
    expect(out.segments).toHaveLength(3);
  });
});
