const {
  calculateBaseSlabFare,
  calculateModelFares,
  findVehicleSlabConfig,
  DEFAULT_SLAB_RATES,
  DEFAULT_MODEL_MULTIPLIERS,
} = require("../slabPricingService");

describe("Slab Pricing Engine", () => {
  const bikeConfig = DEFAULT_SLAB_RATES.bike;
  const tataConfig = DEFAULT_SLAB_RATES.four_wheeler;

  test("Bike @ 20km matches the user-specified distance-slab formula exactly (₹179)", () => {
    // 0-1km: 1 * 1 = 1
    // 1-5km: 4 * 4 = 16
    // 5-10km: 5 * 9.4 = 47
    // 10-15km: 5 * 7.2 = 36
    // 15-20km: 5 * 7.4 = 37
    // Total slab cost = 137
    // Min charge = 42
    // Raw base fare = 42 + 137 = 179
    const result = calculateBaseSlabFare(bikeConfig, 20);
    expect(result.minCharge).toBe(42);
    expect(result.totalDistanceCharge).toBe(137);
    expect(result.rawFare).toBe(179);
  });

  test("Bike @ 20km calculates model fares with +10% anchor markup & offsets", () => {
    const calculation = calculateModelFares(bikeConfig, DEFAULT_MODEL_MULTIPLIERS, 20);
    const models = calculation.models;

    const m1 = models.find((m) => m.model === "Model 1");
    const m2 = models.find((m) => m.model === "Model 2");
    const m3 = models.find((m) => m.model === "Model 3");
    const m4 = models.find((m) => m.model === "Model 4");
    const m5 = models.find((m) => m.model === "Model 5");

    // Model 3 (Anchor): 179 * 1.10 = 196.9 -> 197
    expect(m3.fare).toBe(197);

    // Model 1: 196.9 * (1 - 0.10) = 177.21 -> 177
    expect(m1.fare).toBe(177);

    // Model 2: 196.9 * (1 - 0.05) = 187.055 -> 187
    expect(m2.fare).toBe(187);

    // Model 4: 196.9 * (1 + 0.10) = 216.59 -> 217
    expect(m4.fare).toBe(217);

    // Model 5: 196.9 * (1 + 0.20) = 236.28 -> 236
    expect(m5.fare).toBe(236);
  });

  test("Tata Ace / 4 Wheeler @ 10km calculates correctly", () => {
    // Min charge = 287
    // 0-1km: 1 * 10 = 10
    // 1-5km: 4 * 25.5 = 102
    // 5-10km: 5 * 39 = 195
    // Total slab cost = 307
    // Raw fare = 287 + 307 = 594
    const result = calculateBaseSlabFare(tataConfig, 10);
    expect(result.minCharge).toBe(287);
    expect(result.totalDistanceCharge).toBe(307);
    expect(result.rawFare).toBe(594);

    const calculation = calculateModelFares(tataConfig, DEFAULT_MODEL_MULTIPLIERS, 10);
    const m3 = calculation.models.find((m) => m.model === "Model 3");
    // 594 * 1.10 = 653.4 -> 653
    expect(m3.fare).toBe(653);
  });

  test("a slab-priced vehicle ignores the rate card's service_charge_percent", () => {
    const { calculateFareBreakdown } = require("../pricingEngine");
    const cfg = findVehicleSlabConfig(DEFAULT_SLAB_RATES, 5);
    const pkg = { title: "Model 3", service_charge_percent: "10", pickup_per_km_charge: 3 };
    const r = calculateFareBreakdown(pkg, 4, 0, 1, 0, cfg, DEFAULT_MODEL_MULTIPLIERS, 0, 0, 0);
    expect(r.serviceCharge).toBe(0);
    expect(r.total).toBe(411);
  });

  test("findVehicleSlabConfig never matches a numeric category id against a vehicle name", () => {
    // Live category ids: E-Loader 3, 3 Wheeler 4, 4 Wheeler 5. "3" is inside "mini 3w" and "4" inside "tata ace / 4w".
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, 3)?.vehicle_key).toBe("e_loader");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "4")?.vehicle_key).toBe("three_wheeler");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, 5)?.vehicle_key).toBe("four_wheeler");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, 1)?.vehicle_key).toBe("bike");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, 9)?.vehicle_key).toBe("mini_3w");
  });

  test("findVehicleSlabConfig resolves various category identifiers and names", () => {
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, 8)?.vehicle_name).toBe("Bike");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "Bike")?.vehicle_name).toBe("Bike");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "Scooter")?.vehicle_name).toBe("Scooter");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "E-Loader")?.vehicle_name).toBe("E-Loader");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "3 Wheeler")?.vehicle_name).toBe("3 Wheeler");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "Tata Ace")?.vehicle_name).toBe("Tata Ace / 4W");
  });
});

describe("time-of-day surcharge bands", () => {
  const {
    normalizeTimeBands,
    hasTimeBands,
    activeTimeBand,
    timeBandRawAmount,
  } = require("../slabPricingService");

  // IST 22:00 = 16:30 UTC, 23:36 = 18:06 UTC, 02:00 (next day) = 20:30 UTC, 11:00 = 05:30 UTC.
  const at = {
    evening: new Date("2026-11-02T16:30:00.000Z"),
    lateNight: new Date("2026-11-02T18:06:00.000Z"),
    afterMidnight: new Date("2026-11-02T20:30:00.000Z"),
    day: new Date("2026-11-02T05:30:00.000Z"),
  };
  const bands = [
    { from: "21:00", to: "23:00", amount: 63.64 },
    { from: "23:00", to: "06:00", amount: 136.36 },
  ];

  test("normalizeTimeBands keeps valid rows, zero-pads clocks and drops bad ones", () => {
    expect(normalizeTimeBands([
      { from: "9:5x", to: "10:00", amount: 10 },
      { from: "9:05", to: "10:00", amount: 12.345 },
      { from: "10:00", to: "10:00", amount: 5 },
      { from: "10:00", to: "11:00", amount: 0 },
      { from: "24:00", to: "11:00", amount: 5 },
      null,
    ])).toEqual([{ from: "09:05", to: "10:00", amount: 12.35 }]);
    expect(normalizeTimeBands(undefined)).toEqual([]);
    expect(normalizeTimeBands("21:00")).toEqual([]);
  });

  test("activeTimeBand matches IST wall clock, including a window that wraps past midnight", () => {
    expect(activeTimeBand(bands, at.day)).toBeNull();
    expect(activeTimeBand(bands, at.evening).amount).toBe(63.64);
    expect(activeTimeBand(bands, at.lateNight).amount).toBe(136.36);
    expect(activeTimeBand(bands, at.afterMidnight).amount).toBe(136.36);
  });

  test("the end of a band is exclusive and the start inclusive; minutes since midnight are accepted too", () => {
    expect(activeTimeBand(bands, 22 * 60 + 59).amount).toBe(63.64);
    expect(activeTimeBand(bands, 23 * 60).amount).toBe(136.36);
    expect(activeTimeBand(bands, 6 * 60)).toBeNull();
    expect(activeTimeBand(bands, 21 * 60 - 1)).toBeNull();
  });

  test("hasTimeBands / timeBandRawAmount read the vehicle config", () => {
    expect(hasTimeBands({ time_bands: bands })).toBe(true);
    expect(hasTimeBands({ time_bands: [] })).toBe(false);
    expect(hasTimeBands({})).toBe(false);
    expect(timeBandRawAmount({ time_bands: bands }, at.evening)).toBe(63.64);
    expect(timeBandRawAmount({}, at.evening)).toBe(0);
  });

  test("calculateModelFares adds the band to every model, scaled by markup and offset, only when a time is given", () => {
    const cfg = { ...DEFAULT_SLAB_RATES.three_wheeler, min_charge: 148, rates: { "0_1": 17.8, "1_5": 17.8, "5_10": 17.8 }, time_bands: bands };
    const mult = { anchor_markup_percent: 10, models: [{ model: "Model 1", offset_percent: -10 }, { model: "Model 2", offset_percent: 0 }, { model: "Model 3", offset_percent: 8 }] };
    const day = calculateModelFares(cfg, mult, 5);
    const night = calculateModelFares(cfg, mult, 5, 22 * 60);
    expect(day.models.map((m) => m.fare)).toEqual([235, 261, 282]);
    expect(night.models.map((m) => m.fare)).toEqual([298, 331, 357]);
    expect(night.models[1].time_band_charge).toBe(70);
    expect(day.models[1].time_band_charge).toBe(0);
  });
});
