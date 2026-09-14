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

  test("findVehicleSlabConfig resolves various category identifiers and names", () => {
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, 8)?.vehicle_name).toBe("Bike");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "Bike")?.vehicle_name).toBe("Bike");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "Scooter")?.vehicle_name).toBe("Scooter");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "E-Loader")?.vehicle_name).toBe("E-Loader");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "3 Wheeler")?.vehicle_name).toBe("3 Wheeler");
    expect(findVehicleSlabConfig(DEFAULT_SLAB_RATES, "Tata Ace")?.vehicle_name).toBe("Tata Ace / 4W");
  });
});
