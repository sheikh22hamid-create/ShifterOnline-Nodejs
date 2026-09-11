const prisma = require("../config/db");
const logger = require("../utils/logger");

const SLAB_INTERVALS = [
  { key: "0_1", from: 0, to: 1, label: "0–1 km", defaultSpan: 1 },
  { key: "1_5", from: 1, to: 5, label: "1–5 km", defaultSpan: 4 },
  { key: "5_10", from: 5, to: 10, label: "5–10 km", defaultSpan: 5 },
  { key: "10_15", from: 10, to: 15, label: "10–15 km", defaultSpan: 5 },
  { key: "15_20", from: 15, to: 20, label: "15–20 km", defaultSpan: 5 },
  { key: "20_25", from: 20, to: 25, label: "20–25 km", defaultSpan: 5 },
  { key: "25_30", from: 25, to: 30, label: "25–30 km", defaultSpan: 5 },
  { key: "30_40", from: 30, to: 40, label: "30–40 km", defaultSpan: 10 },
  { key: "40_50", from: 40, to: 50, label: "40–50 km", defaultSpan: 10 },
  { key: "50_60", from: 50, to: 60, label: "50–60 km", defaultSpan: 10 },
  { key: "60_plus", from: 60, to: Infinity, label: "60+ km", defaultSpan: 0 },
];

const DEFAULT_SLAB_RATES = {
  bike: {
    vehicle_key: "bike",
    vehicle_name: "Bike",
    category_id: 8,
    min_charge: 42,
    rates: {
      "0_1": 1.0,
      "1_5": 4.0,
      "5_10": 9.4,
      "10_15": 7.2,
      "15_20": 7.4,
      "20_25": 11.2,
      "25_30": 8.8,
      "30_40": 14.1,
      "40_50": 14.1,
      "50_60": 14.1,
      "60_plus": 14.1,
    },
  },
  scooter: {
    vehicle_key: "scooter",
    vehicle_name: "Scooter",
    category_id: 16,
    min_charge: 48,
    rates: {
      "0_1": 2.0,
      "1_5": 4.5,
      "5_10": 10.8,
      "10_15": 8.2,
      "15_20": 8.6,
      "20_25": 12.8,
      "25_30": 10.2,
      "30_40": 16.4,
      "40_50": 16.3,
      "50_60": 16.3,
      "60_plus": 16.3,
    },
  },
  mini_3w: {
    vehicle_key: "mini_3w",
    vehicle_name: "Mini 3W",
    category_id: 9,
    min_charge: 103,
    rates: {
      "0_1": 5.0,
      "1_5": 8.5,
      "5_10": 18.6,
      "10_15": 13.4,
      "15_20": 12.4,
      "20_25": 20.8,
      "25_30": 16.4,
      "30_40": 18.8,
      "40_50": 18.8,
      "50_60": 18.8,
      "60_plus": 18.8,
    },
  },
  e_loader: {
    vehicle_key: "e_loader",
    vehicle_name: "E-Loader",
    category_id: 23,
    min_charge: 143,
    rates: {
      "0_1": 8.0,
      "1_5": 10.75,
      "5_10": 20.0,
      "10_15": 12.6,
      "15_20": 12.2,
      "20_25": 20.4,
      "25_30": 15.8,
      "30_40": 18.3,
      "40_50": 18.3,
      "50_60": 18.3,
      "60_plus": 18.3,
    },
  },
  three_wheeler: {
    vehicle_key: "three_wheeler",
    vehicle_name: "3 Wheeler",
    category_id: 24,
    min_charge: 195,
    rates: {
      "0_1": 10.0,
      "1_5": 21.5,
      "5_10": 23.6,
      "10_15": 18.2,
      "15_20": 15.4,
      "20_25": 25.2,
      "25_30": 19.8,
      "30_40": 22.9,
      "40_50": 22.8,
      "50_60": 22.8,
      "60_plus": 22.8,
    },
  },
  four_wheeler: {
    vehicle_key: "four_wheeler",
    vehicle_name: "Tata Ace / 4W",
    category_id: 25,
    min_charge: 287,
    rates: {
      "0_1": 10.0,
      "1_5": 25.5,
      "5_10": 39.0,
      "10_15": 30.0,
      "15_20": 27.8,
      "20_25": 39.6,
      "25_30": 63.6,
      "30_40": 36.7,
      "40_50": 36.5,
      "50_60": 36.5,
      "60_plus": 36.5,
    },
  },
};

const DEFAULT_MODEL_MULTIPLIERS = {
  anchor_model: "Model 3",
  anchor_markup_percent: 10, // +10% on raw base rates for Model 3
  models: [
    {
      model: "Model 1",
      offset_percent: -10, // -10% of Model 3
      user_title: "Super Saver",
      driver_title: "Standard Tier",
    },
    {
      model: "Model 2",
      offset_percent: -5, // -5% of Model 3
      user_title: "Saver Plus",
      driver_title: "Silver Tier",
    },
    {
      model: "Model 3",
      offset_percent: 0, // Baseline Model 3 (100%)
      user_title: "Comfort",
      driver_title: "Prime Tier",
    },
    {
      model: "Model 4",
      offset_percent: 10, // +10% of Model 3
      user_title: "Express",
      driver_title: "Gold Beast",
    },
    {
      model: "Model 5",
      offset_percent: 20, // +20% of Model 3
      user_title: "Priority",
      driver_title: "Earning Beast",
    },
  ],
};

let cachedSlabRates = null;
let cachedModelMultipliers = null;

async function getSlabPricingConfig() {
  if (cachedSlabRates && cachedModelMultipliers) {
    return { slabRates: cachedSlabRates, modelMultipliers: cachedModelMultipliers };
  }

  try {
    const [slabsSetting, multipliersSetting] = await Promise.all([
      prisma.app_settings.findUnique({ where: { setting_key: "pricing_slab_rates" } }),
      prisma.app_settings.findUnique({ where: { setting_key: "pricing_model_multipliers" } }),
    ]);

    cachedSlabRates = slabsSetting?.setting_value ? JSON.parse(slabsSetting.setting_value) : DEFAULT_SLAB_RATES;
    cachedModelMultipliers = multipliersSetting?.setting_value
      ? JSON.parse(multipliersSetting.setting_value)
      : DEFAULT_MODEL_MULTIPLIERS;
  } catch (err) {
    logger.error("Error loading slab pricing config from DB:", err);
    cachedSlabRates = DEFAULT_SLAB_RATES;
    cachedModelMultipliers = DEFAULT_MODEL_MULTIPLIERS;
  }

  return { slabRates: cachedSlabRates, modelMultipliers: cachedModelMultipliers };
}

async function saveSlabPricingConfig({ slabRates, modelMultipliers }) {
  if (slabRates) {
    await prisma.app_settings.upsert({
      where: { setting_key: "pricing_slab_rates" },
      create: {
        setting_key: "pricing_slab_rates",
        setting_value: JSON.stringify(slabRates),
        updated_at: new Date(),
      },
      update: {
        setting_value: JSON.stringify(slabRates),
        updated_at: new Date(),
      },
    });
    cachedSlabRates = slabRates;
  }

  if (modelMultipliers) {
    await prisma.app_settings.upsert({
      where: { setting_key: "pricing_model_multipliers" },
      create: {
        setting_key: "pricing_model_multipliers",
        setting_value: JSON.stringify(modelMultipliers),
        updated_at: new Date(),
      },
      update: {
        setting_value: JSON.stringify(modelMultipliers),
        updated_at: new Date(),
      },
    });
    cachedModelMultipliers = modelMultipliers;
  }

  return { success: true, slabRates: cachedSlabRates, modelMultipliers: cachedModelMultipliers };
}

/**
 * Calculates cumulative distance slab breakdown for a given distance and vehicle slab configuration.
 * Formula:
 *   For each slab [from, to]:
 *     kmInSlab = max(0, min(distanceKm, to) - from)
 *     charge = kmInSlab * slab_rate
 *   Distance Charge = sum(charge)
 *   Raw Total = Min Charge + Distance Charge
 */
function calculateBaseSlabFare(vehicleSlabConfig, distanceKm) {
  const minCharge = Number(vehicleSlabConfig?.min_charge) || 0;
  const rates = vehicleSlabConfig?.rates || {};
  const dist = Math.max(0, Number(distanceKm) || 0);

  const breakdown = [];
  let totalDistanceCharge = 0;

  for (const interval of SLAB_INTERVALS) {
    const kmInSlab = Math.max(0, Math.min(dist, interval.to) - interval.from);
    const rate = Number(rates[interval.key]) || 0;
    const charge = kmInSlab * rate;

    if (kmInSlab > 0) {
      breakdown.push({
        key: interval.key,
        label: interval.label,
        from: interval.from,
        to: interval.to,
        km: Math.round(kmInSlab * 100) / 100,
        rate,
        charge: Math.round(charge * 100) / 100,
      });
      totalDistanceCharge += charge;
    }
  }

  const rawFare = minCharge + totalDistanceCharge;

  return {
    minCharge,
    distanceKm: dist,
    totalDistanceCharge: Math.round(totalDistanceCharge * 100) / 100,
    rawFare: Math.round(rawFare * 100) / 100,
    breakdown,
  };
}

/**
 * Calculates fare for all 5 models based on the vehicle's slab rates and model multipliers:
 * 1. Base raw fare = min_charge + slab_charges
 * 2. Model 3 fare = Base raw fare * (1 + anchor_markup_percent / 100)
 * 3. Model X fare = Model 3 fare * (1 + offset_percent / 100)
 */
function calculateModelFares(vehicleSlabConfig, modelMultipliersConfig, distanceKm) {
  const baseCalc = calculateBaseSlabFare(vehicleSlabConfig, distanceKm);
  const anchorMarkup = Number(modelMultipliersConfig?.anchor_markup_percent) || 10;
  const anchorMultiplier = 1 + anchorMarkup / 100;

  const modelResults = (modelMultipliersConfig?.models || DEFAULT_MODEL_MULTIPLIERS.models).map((m) => {
    const offset = Number(m.offset_percent) || 0;
    const offsetMultiplier = 1 + offset / 100;

    // Model 3 is raw * anchorMultiplier.
    // Other models scale relative to Model 3.
    const effectiveMultiplier = anchorMultiplier * offsetMultiplier;

    const modelMinCharge = Math.round(baseCalc.minCharge * effectiveMultiplier * 100) / 100;
    const modelDistanceCharge = Math.round(baseCalc.totalDistanceCharge * effectiveMultiplier * 100) / 100;
    const calculatedFare = Math.round(baseCalc.rawFare * effectiveMultiplier);

    return {
      model: m.model,
      user_title: m.user_title,
      driver_title: m.driver_title,
      offset_percent: offset,
      effective_multiplier: effectiveMultiplier,
      min_charge: modelMinCharge,
      distance_charge: modelDistanceCharge,
      fare: calculatedFare,
    };
  });

  return {
    distanceKm,
    baseCalculation: baseCalc,
    anchorMarkupPercent: anchorMarkup,
    models: modelResults,
  };
}

/**
 * Helper to match a vehicle category (by id or name) to its slab configuration.
 */
function findVehicleSlabConfig(slabRates, catIdOrName) {
  if (!slabRates) return null;

  const input = String(catIdOrName || "").toLowerCase().trim();
  for (const key of Object.keys(slabRates)) {
    const cfg = slabRates[key];
    if (String(cfg.category_id) === input || cfg.vehicle_key.toLowerCase() === input) {
      return cfg;
    }
    const vName = (cfg.vehicle_name || "").toLowerCase();
    if (vName && (vName === input || input.includes(vName) || vName.includes(input))) {
      return cfg;
    }
  }

  // Fallback mappings for known variations
  if (input.includes("bike") || input.includes("two") || input === "8") return slabRates.bike;
  if (input.includes("scooter") || input === "16") return slabRates.scooter;
  if (input.includes("mini") || input === "9") return slabRates.mini_3w;
  if (input.includes("loader") || input.includes("electric") || input === "23") return slabRates.e_loader;
  if (input.includes("3 wheeler") || input.includes("three") || input === "24") return slabRates.three_wheeler;
  if (input.includes("4 wheeler") || input.includes("four") || input.includes("ace") || input.includes("tata") || input === "25" || input === "11" || input === "17")
    return slabRates.four_wheeler;

  return null;
}

module.exports = {
  SLAB_INTERVALS,
  DEFAULT_SLAB_RATES,
  DEFAULT_MODEL_MULTIPLIERS,
  getSlabPricingConfig,
  saveSlabPricingConfig,
  calculateBaseSlabFare,
  calculateModelFares,
  findVehicleSlabConfig,
};
