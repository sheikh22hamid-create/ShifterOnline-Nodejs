const { extraDelta, canAddExtra, canApproveExtra, extraAmountMatches } = require("../labourExtra");

const config = {
  enabled: true,
  baseHome: 60,
  baseShop: 80,
  sizeMult: { small: 1, medium: 1.6, large: 2.6 },
  floorMult: { ground: 1, f1_2: 1.4, f3plus: 1.9, lift_factor: 0.6 },
  qtyMult: { q15: 1, q15_40: 1.8, q40plus: 3 },
  accessMult: { shutter: 1, stack_inside: 1.5, loft_basement: 2.2 },
  caps: { max_size: "medium", max_floor: "f1_2", max_qty: "q15_40", blocked_access: ["loft_basement"], heavy_items: [] },
  fee: 0,
};

describe("extraDelta", () => {
  test("bigger reality than declared -> positive delta (prices over-cap reality too)", () => {
    // declared base was ground small (60); on site it's 3rd floor no lift small: 60*1.9=114 -> delta 54
    const d = extraDelta(
      { mode: "home", legs: [{ role: "drop", size: "small", floor: "f3plus", lift: false }] },
      config,
      60
    );
    expect(d).toBe(54);
  });

  test("reality matches declared -> zero delta", () => {
    const d = extraDelta(
      { mode: "home", legs: [{ role: "drop", size: "small", floor: "ground", lift: false }] },
      config,
      60
    );
    expect(d).toBe(0);
  });

  test("reality smaller than declared -> never negative", () => {
    const d = extraDelta(
      { mode: "home", legs: [{ role: "drop", size: "small", floor: "ground", lift: false }] },
      config,
      150
    );
    expect(d).toBe(0);
  });
});

describe("canAddExtra", () => {
  test("only while labour is held", () => {
    expect(canAddExtra("held")).toBe(true);
    expect(canAddExtra("released")).toBe(false);
    expect(canAddExtra("none")).toBe(false);
    expect(canAddExtra("disputed")).toBe(false);
  });
});

describe("canApproveExtra", () => {
  test("held + unapproved + positive amount", () => {
    expect(canApproveExtra({ labourStatus: "held", extraApproved: false, extraAmount: 54 })).toBe(true);
  });
  test("already approved -> false (idempotent)", () => {
    expect(canApproveExtra({ labourStatus: "held", extraApproved: true, extraAmount: 54 })).toBe(false);
  });
  test("zero amount -> false", () => {
    expect(canApproveExtra({ labourStatus: "held", extraApproved: false, extraAmount: 0 })).toBe(false);
  });
  test("not held -> false", () => {
    expect(canApproveExtra({ labourStatus: "released", extraApproved: false, extraAmount: 54 })).toBe(false);
  });
});

describe("extraAmountMatches", () => {
  test("not enforced when the customer omits the expected amount (backward compatible)", () => {
    expect(extraAmountMatches(120, null)).toBe(true);
    expect(extraAmountMatches(120, undefined)).toBe(true);
  });
  test("matches when the pending amount equals what the customer saw", () => {
    expect(extraAmountMatches(120, 120)).toBe(true);
    expect(extraAmountMatches(120.004, 120)).toBe(true); // rounding tolerance
  });
  test("rejects when the driver changed the amount after the customer saw it", () => {
    expect(extraAmountMatches(200, 120)).toBe(false);
    expect(extraAmountMatches(120, 200)).toBe(false);
  });
});
