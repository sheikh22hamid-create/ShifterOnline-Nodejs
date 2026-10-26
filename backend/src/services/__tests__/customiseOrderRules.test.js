const rules = require("../customiseOrderRules");

const NOW = new Date("2026-10-27T10:00:00Z");
const BOUNDS = { minFare: 50, maxFare: 500000, maxWindowHours: 24 };
const GOOD = {
  pickup: { lat: 22.7, lng: 75.8, address: "A, Indore", exact: true },
  drop: { lat: 22.75, lng: 75.9, address: "B, Indore" },
  goods: { description: "Sofa set", quantity: 2, weight_kg: 120, length_cm: 200, width_cm: 90, height_cm: 80 },
  pickup_handling: { floor: 2, carry_m: 20, helpers: 2, load_min: 30, wait_min: 10 },
  drop_handling: { floor: 0, carry_m: 5, helpers: 1, unload_min: 20, wait_min: 5 },
  initial_fare: 1500,
  bargain_start_at: "2026-10-27T11:00:00Z",
  expires_at: "2026-10-27T20:00:00Z",
};

describe("validateCreate", () => {
  it("accepts a complete order and normalises it", () => {
    const out = rules.validateCreate(GOOD, NOW, BOUNDS);
    expect(out.ok).toBe(true);
    expect(out.value.initial_fare).toBe(1500);
    expect(out.value.bargain_start_at).toEqual(new Date("2026-10-27T11:00:00Z"));
    expect(out.value.stops).toEqual([]);
  });

  it("names the missing goods weight in plain words", () => {
    const body = { ...GOOD, goods: { ...GOOD.goods, weight_kg: undefined } };
    const out = rules.validateCreate(body, NOW, BOUNDS);
    expect(out.ok).toBe(false);
    expect(out.errors).toContain("Goods weight is required");
  });

  it("rejects an expiry that is not after the start", () => {
    const out = rules.validateCreate({ ...GOOD, expires_at: "2026-10-27T11:00:00Z" }, NOW, BOUNDS);
    expect(out.errors).toContain("Expiry time must be after the bargaining start time");
  });

  it("rejects a start time in the past", () => {
    const out = rules.validateCreate({ ...GOOD, bargain_start_at: "2026-10-27T09:00:00Z" }, NOW, BOUNDS);
    expect(out.errors).toContain("Bargaining start time cannot be in the past");
  });

  it("rejects a window longer than the configured maximum", () => {
    const out = rules.validateCreate({ ...GOOD, expires_at: "2026-10-29T12:00:00Z" }, NOW, BOUNDS);
    expect(out.errors).toContain("Bargaining window cannot be longer than 24 hours");
  });

  it("rejects a fare below the minimum and a non-numeric fare", () => {
    expect(rules.validateCreate({ ...GOOD, initial_fare: 10 }, NOW, BOUNDS).errors).toContain("Offered fare must be between 50 and 500000");
    expect(rules.validateCreate({ ...GOOD, initial_fare: "abc" }, NOW, BOUNDS).ok).toBe(false);
  });

  it("treats a time with no offset as IST", () => {
    const out = rules.validateCreate({ ...GOOD, bargain_start_at: "2026-10-27T17:00:00", expires_at: "2026-10-27T23:00:00" }, NOW, BOUNDS);
    expect(out.value.bargain_start_at).toEqual(new Date("2026-10-27T11:30:00Z"));
  });

  it("keeps each stop's own details separate", () => {
    const stops = [
      { lat: 22.71, lng: 75.81, address: "S1", kind: "pickup", goods_desc: "Boxes", floor: 3, helpers: 1 },
      { lat: 22.72, lng: 75.82, address: "S2", kind: "drop", goods_desc: "Chairs", floor: 0, helpers: 2 },
    ];
    const out = rules.validateCreate({ ...GOOD, stops }, NOW, BOUNDS);
    expect(out.value.stops.map((s) => [s.seq, s.goods_desc, s.floor, s.helpers])).toEqual([[1, "Boxes", 3, 1], [2, "Chairs", 0, 2]]);
  });

  it("rejects a stop without coordinates", () => {
    const out = rules.validateCreate({ ...GOOD, stops: [{ address: "S1" }] }, NOW, BOUNDS);
    expect(out.errors).toContain("Stop 1 needs a location");
  });

  it("rejects negative handling numbers", () => {
    const out = rules.validateCreate({ ...GOOD, pickup_handling: { ...GOOD.pickup_handling, helpers: -1 } }, NOW, BOUNDS);
    expect(out.ok).toBe(false);
  });
});

describe("isBiddable", () => {
  const order = { status: "open", bargain_start_at: new Date("2026-10-27T11:00:00Z"), expires_at: new Date("2026-10-27T20:00:00Z") };
  it("is not biddable before the start", () => {
    expect(rules.isBiddable(order, NOW)).toEqual({ ok: false, reason: "not_started" });
  });
  it("is biddable inside the window", () => {
    expect(rules.isBiddable(order, new Date("2026-10-27T12:00:00Z"))).toEqual({ ok: true });
  });
  it("is expired exactly at the expiry time", () => {
    expect(rules.isBiddable(order, new Date("2026-10-27T20:00:00Z"))).toEqual({ ok: false, reason: "expired" });
  });
  it("is not biddable when the order is not open", () => {
    expect(rules.isBiddable({ ...order, status: "converted" }, new Date("2026-10-27T12:00:00Z"))).toEqual({ ok: false, reason: "not_open" });
  });
});

describe("driverCanCarry", () => {
  const order = { goods_weight_kg: 600, goods_len_cm: 200, goods_wid_cm: 90, goods_hgt_cm: 80 };
  it("fails when the goods are heavier than the vehicle's load limit", () => {
    expect(rules.driverCanCarry(order, { max_load_kg: 500 }).ok).toBe(false);
  });
  it("skips the check when the category has no limit", () => {
    expect(rules.driverCanCarry(order, { max_load_kg: null, dim_length: null }).ok).toBe(true);
  });
  it("compares the longest side to the longest cargo side, regardless of orientation", () => {
    const cat = { max_load_kg: 1000, dim_length: 1.5, dim_width: 1, dim_height: 1, dim_unit: "m" };
    expect(rules.driverCanCarry(order, cat).ok).toBe(false); // 200 cm long > 1.5 m
    expect(rules.driverCanCarry({ ...order, goods_len_cm: 140 }, cat).ok).toBe(true);
  });
});

describe("driverEligible", () => {
  const base = {
    order: { city_id: 3, category_name: null, goods_weight_kg: 50 },
    rider: { id: 11, status: 1, city_id: 3, vehicle: "Tata Ace" },
    category: { max_load_kg: 750 },
    dismissed: false,
    excludedRiderIds: [],
  };
  it("accepts any vehicle when the customer chose no category and it can carry the goods", () => {
    expect(rules.driverEligible(base)).toBe(true);
  });
  it("rejects a vehicle that is not the selected category", () => {
    expect(rules.driverEligible({ ...base, order: { ...base.order, category_name: "Bike" } })).toBe(false);
  });
  it("rejects a dismissed, excluded, other-city or unapproved driver", () => {
    expect(rules.driverEligible({ ...base, dismissed: true })).toBe(false);
    expect(rules.driverEligible({ ...base, excludedRiderIds: [11] })).toBe(false);
    expect(rules.driverEligible({ ...base, rider: { ...base.rider, city_id: 9 } })).toBe(false);
    expect(rules.driverEligible({ ...base, rider: { ...base.rider, status: 0 } })).toBe(false);
  });
  it("rejects a driver whose vehicle cannot carry the weight", () => {
    expect(rules.driverEligible({ ...base, order: { ...base.order, goods_weight_kg: 900 } })).toBe(false);
  });
});
