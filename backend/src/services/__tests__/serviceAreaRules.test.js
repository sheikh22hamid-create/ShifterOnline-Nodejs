const rules = require("../serviceAreaRules");

// A square around 22.70..22.80 N, 75.80..75.90 E, stored the way the admin map saves polygons: [[lat, lng], ...]
const SQUARE = { polygon_geojson: JSON.stringify([[22.7, 75.8], [22.7, 75.9], [22.8, 75.9], [22.8, 75.8]]), center_lat: 22.75, center_lng: 75.85, radius_km: 1 };
const CIRCLE = { polygon_geojson: null, center_lat: 22.75, center_lng: 75.85, radius_km: 2 };

describe("containsPoint (polygon)", () => {
  it("is true inside and false outside", () => {
    expect(rules.containsPoint(SQUARE, 22.75, 75.85)).toBe(true);
    expect(rules.containsPoint(SQUARE, 22.9, 75.85)).toBe(false);
    expect(rules.containsPoint(SQUARE, 22.75, 76.2)).toBe(false);
  });

  it("counts a point exactly on an edge or a corner as inside", () => {
    expect(rules.containsPoint(SQUARE, 22.7, 75.85)).toBe(true); // bottom edge
    expect(rules.containsPoint(SQUARE, 22.75, 75.9)).toBe(true); // right edge
    expect(rules.containsPoint(SQUARE, 22.8, 75.8)).toBe(true); // corner
  });

  it("accepts the GeoJSON object form too", () => {
    const geo = { polygon_geojson: { type: "Polygon", coordinates: [[[22.7, 75.8], [22.7, 75.9], [22.8, 75.9], [22.8, 75.8]]] } };
    expect(rules.containsPoint(geo, 22.75, 75.85)).toBe(true);
  });

  it("uses the polygon, not the default centre circle, when a polygon exists", () => {
    const farCentre = { ...SQUARE, center_lat: 10, center_lng: 10, radius_km: 5000 };
    expect(rules.containsPoint(farCentre, 22.9, 75.85)).toBe(false);
  });
});

describe("containsPoint (circle)", () => {
  it("includes the radius itself and excludes beyond it", () => {
    expect(rules.containsPoint(CIRCLE, 22.75, 75.85)).toBe(true);
    expect(rules.containsPoint(CIRCLE, 22.75 + 1.9 / 111, 75.85)).toBe(true);
    expect(rules.containsPoint(CIRCLE, 22.75 + 2.5 / 111, 75.85)).toBe(false);
  });
  it("falls back to the circle when the polygon is missing or too short", () => {
    expect(rules.containsPoint({ ...CIRCLE, polygon_geojson: "[[1,1],[2,2]]" }, 22.75, 75.85)).toBe(true);
    expect(rules.containsPoint({ ...CIRCLE, polygon_geojson: "not json" }, 22.75, 75.85)).toBe(true);
  });
});

describe("containsPoint (safe defaults)", () => {
  it("is false for a zone with no usable shape, and for bad coordinates", () => {
    expect(rules.containsPoint({ polygon_geojson: null }, 22.75, 75.85)).toBe(false);
    expect(rules.containsPoint(null, 22.75, 75.85)).toBe(false);
    expect(rules.containsPoint(SQUARE, "x", 75.85)).toBe(false);
    expect(rules.containsPoint(SQUARE, undefined, undefined)).toBe(false);
  });
});

describe("messageFor", () => {
  it("returns the exact brief wording per kind and reason", () => {
    expect(rules.messageFor("pickup", "NO_SERVICE_ZONE")).toBe("No service zone available for this pickup location.");
    expect(rules.messageFor("pickup", "NO_ENTRY")).toBe("Pickup is not allowed in this area for the selected vehicle type.");
    expect(rules.messageFor("drop", "NO_SERVICE_ZONE")).toBe("No service zone available for this drop location.");
    expect(rules.messageFor("drop", "NO_ENTRY")).toBe("Drop location is a no-entry zone for the selected vehicle type. Please choose another location.");
  });
});

describe("validZonePayload", () => {
  it("needs a name and either a polygon of 3+ points or a centre with a positive radius", () => {
    expect(rules.validZonePayload({ name: "A", polygon_geojson: SQUARE.polygon_geojson }).ok).toBe(true);
    expect(rules.validZonePayload({ name: "A", center_lat: 22.7, center_lng: 75.8, radius_km: 2 }).ok).toBe(true);
    expect(rules.validZonePayload({ name: " ", polygon_geojson: SQUARE.polygon_geojson })).toEqual({ ok: false, error: "Zone name is required" });
    expect(rules.validZonePayload({ name: "A", polygon_geojson: "[[1,1],[2,2]]" }).ok).toBe(false);
    expect(rules.validZonePayload({ name: "A", center_lat: 22.7, center_lng: 75.8, radius_km: 0 }).ok).toBe(false);
    expect(rules.validZonePayload({ name: "A", polygon_geojson: "[[1,1],[2,2],[\"a\",3]]" }).ok).toBe(false);
  });
});
