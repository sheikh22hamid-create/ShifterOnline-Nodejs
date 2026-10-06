jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../receiverTrackSettings", () => ({ isTrackingEnabled: jest.fn() }));
jest.mock("../trackEtaService", () => ({ getEta: jest.fn(), getRoute: jest.fn(), clearOrder: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../receiverTrackSettings");
const eta = require("../trackEtaService");
const live = require("../liveDriverPositions");
const { buildSnapshot } = require("../trackSnapshotService");

const NOW = Date.UTC(2026, 9, 6, 10, 0, 0);
const link = { id: 1, order_id: 50, receiver_phone: "9876543210" };
const order = (o = {}) => ({
  id: 50, rid: 9, order_status: 3, o_status: "On_Route", dmobile: "98765 43210",
  plat: "22.70", plong: "75.80", dlat: "22.80", dlong: "75.90",
  paddress: "P".repeat(100), daddress: "Drop address", drop_time: null, ddate: null, ...o,
});
const rider = (o = {}) => ({ first_name: "Suresh Kumar", vehicle_no: "MP09AB1234", fmobile: "9109114515", rlats: "22.71", rlongs: "75.81", rloc_updated_at: new Date(NOW - 10000), ...o });

beforeEach(() => {
  jest.clearAllMocks();
  live._clear();
  settings.isTrackingEnabled.mockResolvedValue(true);
  prisma.pkg_order.findUnique.mockResolvedValue(order());
  prisma.tbl_rider.findUnique.mockResolvedValue(rider());
  prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
  eta.getEta.mockResolvedValue({ minutes: 12, distance_km: 4.2, updated_at: "x" });
  eta.getRoute.mockResolvedValue([[22.7, 75.8], [22.8, 75.9]]);
});

describe("states", () => {
  it("is expired when the feature is switched off", async () => {
    settings.isTrackingEnabled.mockResolvedValue(false);
    expect(await buildSnapshot(link, { now: NOW })).toEqual({ state: "expired", poll_ms: 15000 });
    expect(prisma.pkg_order.findUnique).not.toHaveBeenCalled();
  });
  it("is invalid for a missing order or when the drop contact no longer matches the link", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(null);
    expect((await buildSnapshot(link, { now: NOW })).state).toBe("invalid");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ dmobile: "9000000000" }));
    expect((await buildSnapshot(link, { now: NOW })).state).toBe("invalid");
  });
  it("is cancelled for a cancelled order and releases the caches", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 4, o_status: "Cancelled" }));
    expect(await buildSnapshot(link, { now: NOW })).toEqual({ state: "cancelled", order_id: 50, poll_ms: 15000 });
    expect(eta.clearOrder).toHaveBeenCalledWith(50);
  });
  it("is delivered with the IST delivery time, with no position, for 24 hours", async () => {
    // drop_time holds IST wall-clock: 15:00 IST = 09:30 UTC
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 5, o_status: "Completed", drop_time: new Date("2026-10-06T15:00:00Z") }));
    const s = await buildSnapshot(link, { now: Date.UTC(2026, 9, 7, 8, 0, 0) }); // 22.5 h later
    expect(s).toEqual({ state: "delivered", order_id: 50, step: 5, delivered_at: "2026-10-06T15:00:00.000+05:30", poll_ms: 15000 });
  });
  it("is expired 24 hours after delivery", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 5, o_status: "Completed", drop_time: new Date("2026-10-06T15:00:00Z") }));
    expect((await buildSnapshot(link, { now: Date.UTC(2026, 9, 7, 10, 0, 0) })).state).toBe("expired");
  });
  it("a completed order with no delivery time is delivered with delivered_at null", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 5, o_status: "Completed" }));
    expect(await buildSnapshot(link, { now: NOW })).toMatchObject({ state: "delivered", delivered_at: null });
  });
});

describe("privacy: nothing live before pickup", () => {
  for (const status of [0, 1, 2]) {
    it(`order_status ${status}: no position, route, coordinates or ETA`, async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: status, o_status: "Processing" }));
      live.record(9, 22.71, 75.81, 90, NOW - 1000);
      const s = await buildSnapshot(link, { now: NOW });
      expect(s).toMatchObject({ state: "active", position: null, route: null, pickup: null, drop: null, eta: null });
      expect(eta.getEta).not.toHaveBeenCalled();
      expect(eta.getRoute).not.toHaveBeenCalled();
      expect(JSON.stringify(s)).not.toContain("22.7");
    });
  }
  it("never returns the OTP, booker, fare or payment data", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ otp: 7788, uid: 5, total_dcharge: 450, pmobile: "9811111111" }));
    const text = JSON.stringify(await buildSnapshot(link, { now: NOW }));
    for (const secret of ["7788", "450", "9811111111", "uid", "otp", "total_dcharge"]) expect(text).not.toContain(secret);
  });
});

describe("active steps and driver", () => {
  it("maps order_status to the step, and arrival at drop to step 4", async () => {
    for (const [status, timer, step] of [[0, null, 0], [1, null, 1], [2, null, 2], [3, null, 3], [3, { drop_wait_start: new Date() }, 4]]) {
      prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: status }));
      prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(timer);
      expect((await buildSnapshot(link, { now: NOW })).step).toBe(step);
    }
  });
  it("shows the driver's first name, vehicle and phone", async () => {
    expect((await buildSnapshot(link, { now: NOW })).driver).toEqual({ first_name: "Suresh", vehicle_no: "MP09AB1234", phone: "9109114515" });
  });
  it("has no driver before assignment", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 0, order_status: 0 }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.driver).toBeNull();
    expect(prisma.tbl_rider.findUnique).not.toHaveBeenCalled();
  });
});

describe("on the way (order_status 3)", () => {
  it("returns pickup/drop, the route, and a live position with an ETA to the drop", async () => {
    live.record(9, 22.75, 75.85, 120, NOW - 3000);
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position).toEqual({ lat: 22.75, lng: 75.85, heading: 120, updated_at: new Date(NOW - 3000).toISOString(), stale: false });
    expect(s.pickup).toEqual({ lat: 22.7, lng: 75.8, address: "P".repeat(80) });
    expect(s.drop).toEqual({ lat: 22.8, lng: 75.9, address: "Drop address" });
    expect(s.route).toEqual([[22.7, 75.8], [22.8, 75.9]]);
    expect(s.eta).toMatchObject({ minutes: 12 });
    expect(eta.getEta).toHaveBeenCalledWith(50, { lat: 22.75, lng: 75.85 }, { lat: 22.8, lng: 75.9 });
    expect(s.poll_ms).toBe(5000);
  });
  it("falls back to the database position when there is no live ping", async () => {
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position).toMatchObject({ lat: 22.71, lng: 75.81, stale: false });
  });
  it("marks a position older than 2 minutes as stale and does not compute an ETA from it", async () => {
    live.record(9, 22.75, 75.85, 0, NOW - 3 * 60 * 1000);
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ rloc_updated_at: new Date(NOW - 4 * 60 * 1000) }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position.stale).toBe(true);
    expect(s.eta).toBeNull();
  });
  it("a fresher DB position (REST fix) beats an older live socket ping", async () => {
    live.record(9, 22.75, 75.85, 120, NOW - 5 * 60 * 1000);
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ rloc_updated_at: new Date(NOW - 5000) }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position).toMatchObject({ lat: 22.71, lng: 75.81, stale: false, updated_at: new Date(NOW - 5000).toISOString() });
  });
  it("a fresher live ping beats an older DB position", async () => {
    live.record(9, 22.75, 75.85, 120, NOW - 2000);
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ rloc_updated_at: new Date(NOW - 60000) }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position).toMatchObject({ lat: 22.75, lng: 75.85, heading: 120, stale: false });
  });
  it("uses the live ping when the DB has no position", async () => {
    live.record(9, 22.75, 75.85, 0, NOW - 2000);
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ rlats: null, rlongs: null, rloc_updated_at: null }));
    expect((await buildSnapshot(link, { now: NOW })).position).toMatchObject({ lat: 22.75, lng: 75.85, stale: false });
  });
  it("a DB position with null rloc_updated_at is the oldest source and, alone, is stale", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ rloc_updated_at: null }));
    expect((await buildSnapshot(link, { now: NOW })).position).toMatchObject({ lat: 22.71, stale: true, updated_at: null });
    live.record(9, 22.75, 75.85, 0, NOW - 3 * 60 * 1000);
    expect((await buildSnapshot(link, { now: NOW })).position).toMatchObject({ lat: 22.75, stale: true });
  });
  it("has a null position when the driver never reported one", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ rlats: null, rlongs: null, rloc_updated_at: null }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position).toBeNull();
    expect(s.eta).toBeNull();
    expect(s.route).not.toBeNull();
  });
  it("does not crash on blank or non-numeric order coordinates", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ plat: "", plong: "75.8", dlat: "0", dlong: "0" }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s).toMatchObject({ state: "active", pickup: null, drop: null, route: null, eta: null });
  });
  it("ETA and route failures only blank those fields", async () => {
    live.record(9, 22.75, 75.85, 0, NOW - 1000);
    eta.getEta.mockRejectedValue(new Error("google"));
    eta.getRoute.mockRejectedValue(new Error("google"));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s).toMatchObject({ state: "active", eta: null, route: null });
    expect(s.position).not.toBeNull();
  });
  it("no ETA once the driver is at the drop (step 4)", async () => {
    live.record(9, 22.8, 75.9, 0, NOW - 1000);
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue({ drop_wait_start: new Date() });
    expect((await buildSnapshot(link, { now: NOW })).eta).toBeNull();
  });
});
