const { computeLabour } = require("../labourPricing");

// Fixed config mirrors the migration defaults so the pricing math is tested without a DB.
const config = {
  enabled: true,
  baseHome: 60,
  baseShop: 80,
  sizeMult: { small: 1, medium: 1.6, large: 2.6 },
  floorMult: { ground: 1, f1_2: 1.4, f3plus: 1.9, lift_factor: 0.6 },
  qtyMult: { q15: 1, q15_40: 1.8, q40plus: 3 },
  accessMult: { shutter: 1, stack_inside: 1.5, loft_basement: 2.2 },
  caps: {
    max_size: "medium",
    max_floor: "f1_2",
    max_qty: "q15_40",
    blocked_access: ["loft_basement"],
    heavy_items: ["fridge", "cement", "tandoor", "almirah", "washing_machine"],
  },
  fee: 0,
};

describe("computeLabour", () => {
  test("HOME small/ground single leg = baseHome", () => {
    const r = computeLabour(
      { mode: "home", legs: [{ role: "pickup", size: "small", floor: "ground", lift: false }] },
      config
    );
    expect(r.labourOverCap).toBe(false);
    expect(r.labourCharge).toBe(60);
    expect(r.perLeg).toEqual([{ role: "pickup", charge: 60 }]);
  });

  test("HOME medium/1-2 floor no lift, pickup+drop summed", () => {
    const r = computeLabour(
      {
        mode: "home",
        legs: [
          { role: "pickup", size: "medium", floor: "f1_2", lift: false },
          { role: "drop", size: "medium", floor: "f1_2", lift: false },
        ],
      },
      config
    );
    // 60 * 1.6 * 1.4 = 134.4 -> 134 per leg, summed = 268
    expect(r.labourOverCap).toBe(false);
    expect(r.perLeg).toEqual([
      { role: "pickup", charge: 134 },
      { role: "drop", charge: 134 },
    ]);
    expect(r.labourCharge).toBe(268);
  });

  test("lift reduces the upper-floor premium", () => {
    const noLift = computeLabour(
      { mode: "home", legs: [{ role: "drop", size: "small", floor: "f1_2", lift: false }] },
      config
    ).labourCharge;
    const withLift = computeLabour(
      { mode: "home", legs: [{ role: "drop", size: "small", floor: "f1_2", lift: true }] },
      config
    ).labourCharge;
    expect(withLift).toBeLessThan(noLift);
  });

  test("HOME 3+ floor is over cap (no charge)", () => {
    const r = computeLabour(
      { mode: "home", legs: [{ role: "drop", size: "small", floor: "f3plus", lift: false }] },
      config
    );
    expect(r.labourOverCap).toBe(true);
    expect(r.labourCharge).toBe(0);
  });

  test("HOME large size is over cap", () => {
    const r = computeLabour(
      { mode: "home", legs: [{ role: "pickup", size: "large", floor: "ground", lift: false }] },
      config
    );
    expect(r.labourOverCap).toBe(true);
  });

  test("SHOP 15-40 stack-inside is within cap", () => {
    const r = computeLabour(
      { mode: "shop", legs: [{ role: "drop", qty: "q15_40", access: "stack_inside" }] },
      config
    );
    // 80 * 1.8 * 1.5 = 216
    expect(r.labourOverCap).toBe(false);
    expect(r.labourCharge).toBe(216);
  });

  test("SHOP 40+ quantity is over cap", () => {
    const r = computeLabour(
      { mode: "shop", legs: [{ role: "drop", qty: "q40plus", access: "shutter" }] },
      config
    );
    expect(r.labourOverCap).toBe(true);
  });

  test("SHOP loft/basement access is over cap (blocked)", () => {
    const r = computeLabour(
      { mode: "shop", legs: [{ role: "drop", qty: "q15", access: "loft_basement" }] },
      config
    );
    expect(r.labourOverCap).toBe(true);
  });

  test("heavy item flag forces over cap", () => {
    const r = computeLabour(
      {
        mode: "home",
        heavyItem: true,
        legs: [{ role: "pickup", size: "small", floor: "ground", lift: false }],
      },
      config
    );
    expect(r.labourOverCap).toBe(true);
  });

  test("feature disabled returns disabled with zero charge", () => {
    const r = computeLabour(
      { mode: "home", legs: [{ role: "pickup", size: "small", floor: "ground", lift: false }] },
      { ...config, enabled: false }
    );
    expect(r.disabled).toBe(true);
    expect(r.labourCharge).toBe(0);
  });
});
