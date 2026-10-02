const { selectSamples, buildRoute, recordSamples } = require("../tripRouteService");

const NOW = 1_800_000_000_000;
// ~11.1 m per 0.0001 degree of latitude.
const at = (minAgo, lat, lng, extra = {}) => ({ timestamp: NOW - minAgo * 60000, lat, lng, ...extra });

describe("selectSamples", () => {
  it("keeps valid samples oldest-first and stamps the phase", () => {
    const out = selectSamples({
      samples: [at(1, 22.001, 75.0), at(2, 22.0, 75.0)],
      last: null, phase: 1, now: NOW,
    });
    expect(out.map((s) => s.lat)).toEqual([22.0, 22.001]);
    expect(out.every((s) => s.phase === 1)).toBe(true);
  });

  it("drops non-finite coordinates, null island, and very inaccurate fixes", () => {
    const out = selectSamples({
      samples: [at(5, "abc", 75), at(5, 0, 0), at(4, 22.0, 75.0, { accuracy: 500 }), at(3, 22.0, 75.0, { accuracy: 12 })],
      last: null, phase: 0, now: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0].accuracy).toBe(12);
  });

  it("drops points closer than 10 m to the previously kept one (including the stored last point)", () => {
    const out = selectSamples({
      samples: [at(3, 22.00005, 75.0), at(2, 22.0003, 75.0), at(1, 22.00032, 75.0)],
      last: { lat: 22.0, lng: 75.0 }, phase: 0, now: NOW,
    });
    // 22.00005 is ~5.5 m from last -> dropped; 22.0003 kept; 22.00032 is ~2 m after it -> dropped.
    expect(out.map((s) => s.lat)).toEqual([22.0003]);
  });

  it("drops stale (>6h) and future (>2 min) timestamps", () => {
    const out = selectSamples({
      samples: [at(7 * 60, 22.0, 75.0), at(-5, 22.01, 75.0), at(1, 22.02, 75.0)],
      last: null, phase: 0, now: NOW,
    });
    expect(out.map((s) => s.lat)).toEqual([22.02]);
  });

  it("caps a batch at 120 samples", () => {
    const many = Array.from({ length: 300 }, (_, i) => at(1, 22 + i * 0.001, 75.0));
    expect(selectSamples({ samples: many, last: null, phase: 0, now: NOW }).length).toBeLessThanOrEqual(120);
  });
});

describe("recordSamples", () => {
  it("maps order_status to a phase and inserts only the selected samples", async () => {
    const tx = { driver_trip_location: { findFirst: jest.fn().mockResolvedValue(null), createMany: jest.fn() } };
    await recordSamples(tx, { orderId: 5, riderId: 9, orderStatus: 3, samples: [at(1, 22.0, 75.0)], now: NOW });
    expect(tx.driver_trip_location.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ order_id: 5, rider_id: 9, lat: 22.0, lng: 75.0, phase: 1 })],
    });
  });

  it("does nothing for an inactive order status or empty batch", async () => {
    const tx = { driver_trip_location: { findFirst: jest.fn(), createMany: jest.fn() } };
    await recordSamples(tx, { orderId: 5, riderId: 9, orderStatus: 4, samples: [at(1, 22.0, 75.0)], now: NOW });
    await recordSamples(tx, { orderId: 5, riderId: 9, orderStatus: 1, samples: [], now: NOW });
    expect(tx.driver_trip_location.createMany).not.toHaveBeenCalled();
  });
});

describe("buildRoute", () => {
  function clientWith({ rows = [], stops = [], timer = null, order = {}, pickupEvent = null }) {
    return {
      driver_trip_event: { findUnique: jest.fn().mockResolvedValue(pickupEvent) },
      pkg_order: { findUnique: jest.fn().mockResolvedValue({ id: 5, uid: 3, plat: "22.0", plong: "75.0", dlat: "22.02", dlong: "75.0", distance: 2.4, ...order }) },
      pkg_order_stops: { findMany: jest.fn().mockResolvedValue(stops) },
      pkg_order_wait_timer: { findFirst: jest.fn().mockResolvedValue(timer) },
      driver_trip_location: { findMany: jest.fn().mockResolvedValue(rows) },
    };
  }
  const row = (min, lat, lng, phase) => ({ lat: String(lat), lng: String(lng), phase, recorded_at: new Date(NOW - min * 60000) });

  it("sums the real driven distance and reports start / pickup / drop", async () => {
    const route = await buildRoute(clientWith({
      rows: [row(30, 21.99, 75.0, 0), row(20, 22.0, 75.0, 0), row(10, 22.01, 75.0, 1), row(1, 22.02, 75.0, 1)],
    }), 5);
    expect(route.has_trail).toBe(true);
    // 21.99 -> 22.02 is 0.03 deg latitude = ~3.34 km
    expect(route.distance_km).toBeGreaterThan(3.2);
    expect(route.distance_km).toBeLessThan(3.5);
    expect(route.start).toEqual({ lat: 21.99, lng: 75.0 });
    expect(route.pickup).toEqual({ lat: 22.0, lng: 75.0 });
    expect(route.drop).toEqual({ lat: 22.02, lng: 75.0 });
    expect(route.points).toHaveLength(4);
  });

  it("flags points that follow a long time gap so the client can dash the connector", async () => {
    const route = await buildRoute(clientWith({ rows: [row(120, 22.0, 75.0, 0), row(1, 22.01, 75.0, 1)] }), 5);
    expect(route.points[0].gap).toBeFalsy();
    expect(route.points[1].gap).toBe(true);
  });

  it("falls back to the planned straight line when no trail was recorded", async () => {
    const route = await buildRoute(clientWith({ rows: [] }), 5);
    expect(route.has_trail).toBe(false);
    expect(route.points).toEqual([]);
    expect(route.start).toBeNull();
    expect(route.distance_km).toBe(2.4); // order.distance (planned) is the best we have
  });

  it("treats a single recorded fix as no trail so the app draws the planned path", async () => {
    const route = await buildRoute(clientWith({ rows: [row(5, 22.0, 75.0, 0)] }), 5);
    expect(route.has_trail).toBe(false);
    expect(route.distance_km).toBe(2.4);
  });

  it("includes the OTP point only when it differs from the pickup by more than 50 m", async () => {
    const far = await buildRoute(clientWith({ rows: [], timer: { otp_verify_lat: "22.002", otp_verify_lng: "75.0" } }), 5);
    expect(far.otp_point).toEqual({ lat: 22.002, lng: 75.0 });
    const near = await buildRoute(clientWith({ rows: [], timer: { otp_verify_lat: "22.0001", otp_verify_lng: "75.0" } }), 5);
    expect(near.otp_point).toBeNull();
  });

  it("reports the original pickup and the final pickup when the pickup was changed", async () => {
    const route = await buildRoute(clientWith({ rows: [], pickupEvent: { payload: { old_lat: "22.05", old_lng: "75.05" } } }), 5);
    expect(route.pickup).toEqual({ lat: 22.05, lng: 75.05 });
    expect(route.final_pickup).toEqual({ lat: 22.0, lng: 75.0 });
  });

  it("has no final pickup when the pickup was never changed", async () => {
    const route = await buildRoute(clientWith({ rows: [] }), 5);
    expect(route.final_pickup).toBeNull();
  });

  it("ignores a legacy 0,0 OTP point", async () => {
    const route = await buildRoute(clientWith({ rows: [], timer: { otp_verify_lat: "0", otp_verify_lng: "0" } }), 5);
    expect(route.otp_point).toBeNull();
  });

  it("returns null when the order does not exist", async () => {
    const client = clientWith({});
    client.pkg_order.findUnique.mockResolvedValue(null);
    expect(await buildRoute(client, 99)).toBeNull();
  });
});
