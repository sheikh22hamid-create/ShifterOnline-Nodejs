const { buildConfig, DEFAULTS, normalizeLabourEnabled } = require("../labourSettings");

// buildConfig is the pure part of the app_settings reader: a {key: value} map + cityId -> config.
describe("buildConfig", () => {
  test("empty settings -> defaults, feature disabled", () => {
    const c = buildConfig({}, 1);
    expect(c.enabled).toBe(false);
    expect(c.baseHome).toBe(DEFAULTS.baseHome);
    expect(c.sizeMult.medium).toBe(DEFAULTS.sizeMult.medium);
    expect(c.caps.blocked_access).toContain("loft_basement");
  });

  test("global enable turns it on for any city", () => {
    const c = buildConfig({ labour_enabled: '{"global":true,"cities":{}}' }, 7);
    expect(c.enabled).toBe(true);
  });

  test("per-city override beats global", () => {
    const map = { labour_enabled: '{"global":false,"cities":{"5":true}}' };
    expect(buildConfig(map, 5).enabled).toBe(true);
    expect(buildConfig(map, 9).enabled).toBe(false);
  });

  test("custom slab values from app_settings override defaults", () => {
    const c = buildConfig({ labour_base_home: "100", labour_size_mult: '{"small":1,"medium":2,"large":3}' }, 1);
    expect(c.baseHome).toBe(100);
    expect(c.sizeMult.medium).toBe(2);
  });

  test("malformed JSON falls back to default for that key", () => {
    const c = buildConfig({ labour_size_mult: "{not json" }, 1);
    expect(c.sizeMult).toEqual(DEFAULTS.sizeMult);
  });
});

// normalizeLabourEnabled sanitizes the admin toggle payload into a safe {global, cities} object
// before it is stored as the labour_enabled app_setting (buildConfig then reads it per booking).
describe("normalizeLabourEnabled", () => {
  test("empty / non-object -> feature off everywhere", () => {
    expect(normalizeLabourEnabled(null)).toEqual({ global: false, cities: {} });
    expect(normalizeLabourEnabled("x")).toEqual({ global: false, cities: {} });
    expect(normalizeLabourEnabled({})).toEqual({ global: false, cities: {} });
  });
  test("coerces global truthy forms to a real boolean", () => {
    expect(normalizeLabourEnabled({ global: true }).global).toBe(true);
    expect(normalizeLabourEnabled({ global: "true" }).global).toBe(true);
    expect(normalizeLabourEnabled({ global: 1 }).global).toBe(true);
    expect(normalizeLabourEnabled({ global: 0 }).global).toBe(false);
  });
  test("keeps only ON cities, keyed by positive integer id as string", () => {
    const r = normalizeLabourEnabled({ cities: { 1: true, 2: false, 3: "true" } });
    expect(r.cities).toEqual({ 1: true, 3: true });
  });
  test("drops bogus city keys (non-integer, zero, negative)", () => {
    const r = normalizeLabourEnabled({ cities: { abc: true, 0: true, "-4": true, 7: true } });
    expect(r.cities).toEqual({ 7: true });
  });
  test("round-trips through buildConfig: an ON city is enabled, an absent city follows global", () => {
    const stored = JSON.stringify(normalizeLabourEnabled({ global: false, cities: { 1: true } }));
    expect(buildConfig({ labour_enabled: stored }, 1).enabled).toBe(true);
    expect(buildConfig({ labour_enabled: stored }, 2).enabled).toBe(false);
  });
});
