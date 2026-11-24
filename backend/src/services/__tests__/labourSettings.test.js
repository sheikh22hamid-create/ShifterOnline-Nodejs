const { buildConfig, DEFAULTS } = require("../labourSettings");

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
