const rules = require("../globalIndiaRules");

const circle = (id, city_id, lat, lng, radius_km, extra = {}) => ({ id, city_id, center_lat: lat, center_lng: lng, radius_km, polygon_geojson: null, status: 1, ...extra });
const INDORE = { lat: 22.7196, lng: 75.8577 };
const UJJAIN = { lat: 23.1765, lng: 75.7885 };
const BETWEEN = { lat: 22.95, lng: 75.82 }; // between the two cities, outside both circles below

describe("isInsideIndia (real boundary data)", () => {
  it.each([
    ["Indore", 22.7196, 75.8577], ["Ujjain", 23.1765, 75.7885], ["Delhi", 28.6139, 77.209], ["Mumbai", 19.076, 72.8777],
    ["Chennai", 13.0827, 80.2707], ["Kolkata", 22.5726, 88.3639], ["Kanyakumari", 8.0883, 77.5385], ["Leh", 34.1526, 77.5771],
    ["Guwahati", 26.1445, 91.7362], ["Port Blair (Andaman)", 11.6234, 92.7265],
  ])("%s is inside India", (_name, lat, lng) => expect(rules.isInsideIndia(lat, lng)).toBe(true));

  it.each([
    ["Colombo", 6.9271, 79.8612], ["Karachi", 24.8607, 67.0011], ["Kathmandu", 27.7172, 85.324], ["Dhaka", 23.8103, 90.4125],
    ["Dubai", 25.2048, 55.2708], ["Singapore", 1.3521, 103.8198], ["Null Island", 0, 0], ["Bay of Bengal", 14, 88],
  ])("%s is outside India", (_name, lat, lng) => expect(rules.isInsideIndia(lat, lng)).toBe(false));

  it("a missing, non-numeric or impossible coordinate is never inside", () => {
    expect(rules.isInsideIndia(null, 75)).toBe(false);
    expect(rules.isInsideIndia("x", "y")).toBe(false);
    expect(rules.isInsideIndia(95, 75)).toBe(false);
    expect(rules.isInsideIndia(undefined, undefined)).toBe(false);
  });
});

describe("decide - who serves a pickup", () => {
  const zones = [circle(1, 10, INDORE.lat, INDORE.lng, 25), circle(2, 20, UJJAIN.lat, UJJAIN.lng, 15)];
  const base = { zones, activeCityIds: [10, 20], globalCityId: 99 };

  it("A: inside Indore's geofence -> Indore", () => {
    expect(rules.decide({ ...base, ...INDORE })).toMatchObject({ kind: "city", cityId: 10 });
  });
  it("B: inside Ujjain's geofence -> Ujjain", () => {
    expect(rules.decide({ ...base, ...UJJAIN })).toMatchObject({ kind: "city", cityId: 20 });
  });
  it("C: between the two, outside both, inside India -> Global India", () => {
    expect(rules.decide({ ...base, ...BETWEEN })).toEqual({ kind: "global", cityId: 99 });
  });
  it("outside India -> not serviceable, Global India does not apply", () => {
    expect(rules.decide({ ...base, lat: 6.9271, lng: 79.8612 })).toEqual({ kind: "outside_india" });
  });

  it("an area joins a city the moment its geofence grows (and leaves it when it shrinks)", () => {
    expect(rules.decide({ ...base, ...BETWEEN }).kind).toBe("global");
    const grown = [circle(1, 10, INDORE.lat, INDORE.lng, 60), zones[1]]; // Indore's circle now reaches BETWEEN
    expect(rules.decide({ ...base, zones: grown, ...BETWEEN })).toMatchObject({ kind: "city", cityId: 10 });
    expect(rules.decide({ ...base, zones, ...BETWEEN }).kind).toBe("global"); // shrunk back
  });

  it("an area moves from one city to another when the geofences change", () => {
    const toUjjain = [circle(1, 10, INDORE.lat, INDORE.lng, 25), circle(2, 20, UJJAIN.lat, UJJAIN.lng, 60)];
    expect(rules.decide({ ...base, zones: toUjjain, ...BETWEEN })).toMatchObject({ kind: "city", cityId: 20 });
  });

  it("an inactive city's geofence, a zone with no city and the Global city's own zone never count", () => {
    expect(rules.decide({ ...base, activeCityIds: [20], ...INDORE }).kind).toBe("global"); // Indore deactivated
    expect(rules.decide({ ...base, zones: [circle(3, null, INDORE.lat, INDORE.lng, 25)], ...INDORE }).kind).toBe("global");
    expect(rules.decide({ ...base, zones: [circle(4, 99, INDORE.lat, INDORE.lng, 25)], ...INDORE }).kind).toBe("global");
  });

  it("overlapping geofences: the smallest (most specific) zone wins, equal areas go to the lowest id", () => {
    const overlapping = [circle(5, 10, INDORE.lat, INDORE.lng, 100), circle(6, 30, INDORE.lat, INDORE.lng, 8)];
    expect(rules.decide({ ...base, zones: overlapping, activeCityIds: [10, 30], ...INDORE })).toMatchObject({ kind: "city", cityId: 30, zoneId: 6 });
    const same = [circle(9, 10, INDORE.lat, INDORE.lng, 10), circle(7, 30, INDORE.lat, INDORE.lng, 10)];
    expect(rules.decide({ ...base, zones: same, activeCityIds: [10, 30], ...INDORE })).toMatchObject({ zoneId: 7, cityId: 30 });
  });

  it("a polygon zone works like a circle", () => {
    const polygon = { id: 8, city_id: 10, status: 1, polygon_geojson: JSON.stringify([[22.9, 75.7], [22.9, 75.95], [23.0, 75.95], [23.0, 75.7]]) };
    expect(rules.decide({ ...base, zones: [polygon], ...BETWEEN })).toMatchObject({ kind: "city", cityId: 10 });
  });

  it("inside India with no Global India city set up is reported, not guessed", () => {
    expect(rules.decide({ ...base, globalCityId: null, ...BETWEEN })).toEqual({ kind: "no_global" });
  });
});

describe("zoneAreaKm2", () => {
  it("is about pi r^2 for a circle and positive for a polygon", () => {
    expect(rules.zoneAreaKm2({ radius_km: 10 })).toBeCloseTo(Math.PI * 100, 5);
    const polygon = { polygon_geojson: JSON.stringify([[22.9, 75.7], [22.9, 75.95], [23.0, 75.95], [23.0, 75.7]]) };
    expect(rules.zoneAreaKm2(polygon)).toBeGreaterThan(200);
    expect(rules.zoneAreaKm2({})).toBe(Infinity);
  });
});
