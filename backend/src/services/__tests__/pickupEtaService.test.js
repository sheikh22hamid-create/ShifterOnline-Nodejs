jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findFirst: jest.fn() },
  $executeRaw: jest.fn().mockResolvedValue(1),
  $queryRaw: jest.fn(),
}));

const prisma = require("../../config/db");
const svc = require("../pickupEtaService");

describe("buildEtaPlan", () => {
  it("adds the buffer to Google's travel time (20 min + 10 min = 30 min)", () => {
    const now = Date.UTC(2026, 9, 2, 10, 0, 0);
    const plan = svc.buildEtaPlan({ googleSeconds: 20 * 60, bufferMinutes: 10, now });
    expect(plan).toMatchObject({ googleMinutes: 20, customerMinutes: 30 });
    expect(plan.deadline.getTime()).toBe(now + 30 * 60000);
  });

  it("rounds Google seconds up to a whole minute and never goes below 1", () => {
    expect(svc.buildEtaPlan({ googleSeconds: 61, bufferMinutes: 10 }).googleMinutes).toBe(2);
    expect(svc.buildEtaPlan({ googleSeconds: 5, bufferMinutes: 0 })).toMatchObject({ googleMinutes: 1, customerMinutes: 1 });
  });
});

describe("getPickupEtaSettings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("defaults to a 10 minute buffer, 200 m geofence and auto-cancel on", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await svc.getPickupEtaSettings()).toEqual({ bufferMinutes: 10, geofenceM: 200, autoCancelEnabled: true });
  });

  it("reads the admin values, including switching auto-cancel off", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "pickup_eta_buffer_minutes", setting_value: "15" },
      { setting_key: "pickup_eta_geofence_m", setting_value: "120" },
      { setting_key: "pickup_eta_auto_cancel_enabled", setting_value: "0" },
    ]);
    expect(await svc.getPickupEtaSettings()).toEqual({ bufferMinutes: 15, geofenceM: 120, autoCancelEnabled: false });
  });
});

describe("fetchGoogleDrive", () => {
  const origin = { lat: 22.0, lng: 75.0 };
  const dest = { lat: 22.05, lng: 75.0 };

  it("parses Google's duration string and distance", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ duration: "1200s", distanceMeters: 5400 }] }) });
    expect(await svc.fetchGoogleDrive(origin, dest, { fetchImpl, apiKey: "k" })).toEqual({ seconds: 1200, meters: 5400 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("routes.googleapis.com");
    expect(JSON.parse(init.body)).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE" });
  });

  it("returns null without a key, on an HTTP error, or on a network failure", async () => {
    expect(await svc.fetchGoogleDrive(origin, dest, { fetchImpl: jest.fn(), apiKey: "" })).toBeNull();
    expect(await svc.fetchGoogleDrive(origin, dest, { fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 403 }), apiKey: "k" })).toBeNull();
    expect(await svc.fetchGoogleDrive(origin, dest, { fetchImpl: jest.fn().mockRejectedValue(new Error("boom")), apiKey: "k" })).toBeNull();
  });
});

describe("computeAndStorePickupEta", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.app_settings.findMany.mockResolvedValue([]);
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 5, rid: 9, plat: "22.05", plong: "75.0" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ rlats: "22.0", rlongs: "75.0" });
  });

  it("stores Google's minutes and a deadline = now + google + buffer, and returns the customer ETA", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ duration: "1200s", distanceMeters: 5400 }] }) });
    process.env.GOOGLE_MAPS_API_KEY = "k";
    const before = Date.now();
    const eta = await svc.computeAndStorePickupEta(5, { fetchImpl });

    expect(eta).toMatchObject({ pickup_distance_km: 5.4, pickup_google_eta_minutes: 20, pickup_eta_minutes: 30, pickup_eta_source: "google" });
    expect(eta.pickup_deadline_at.getTime()).toBeGreaterThanOrEqual(before + 30 * 60000);
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { pickup_distance_km: 5.4, pickup_duration_min: 20 } });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it("falls back to a straight-line estimate when Google is unavailable", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const eta = await svc.computeAndStorePickupEta(5);
    expect(eta.pickup_eta_source).toBe("estimate");
    expect(eta.pickup_eta_minutes).toBeGreaterThan(10);
  });

  it("returns null (never throws) when the driver has no GPS fix yet", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ rlats: null, rlongs: null });
    expect(await svc.computeAndStorePickupEta(5)).toBeNull();
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();
  });
});

describe("buildEtaView", () => {
  it("exposes the remaining seconds only while the driver is still heading to pickup", () => {
    const now = Date.UTC(2026, 9, 2, 10, 0, 0);
    const row = { pickup_eta_minutes: 30, pickup_deadline_at: new Date(now + 600000) };
    expect(svc.buildEtaView({ order_status: 1, pickup_distance_km: "5.4", pickup_duration_min: 20 }, row, now)).toMatchObject({
      pickup_eta_minutes: 30, pickup_google_eta_minutes: 20, pickup_distance_km: "5.4", pickup_eta_remaining_seconds: 600,
    });
    expect(svc.buildEtaView({ order_status: 2 }, row, now).pickup_eta_remaining_seconds).toBe(0);
  });
});
