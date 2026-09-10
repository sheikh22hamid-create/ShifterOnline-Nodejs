const { buildNextDaySequence } = require("../geoDistance");

describe("buildNextDaySequence", () => {
  it("chains nearest-pickup-from-current-position, in order", () => {
    // Driver starts at (0,0). Order A's pickup is at (0,1) [~111km away],
    // order B's pickup is at (0,5) [~555km away]. Driver should go to A
    // first. A's drop is at (0,2) — from there B's pickup (0,5) is now the
    // only one left, so B is next regardless of distance.
    const orders = [
      { id: 100, plat: 0, plong: 5, dlat: 0, dlong: 6 }, // "B" — farther pickup
      { id: 200, plat: 0, plong: 1, dlat: 0, dlong: 2 }, // "A" — nearer pickup
    ];

    const sequence = buildNextDaySequence(0, 0, orders);

    expect(sequence.map((s) => s.order_id)).toEqual([200, 100]);
    expect(sequence[0].pickup_distance_km).toBeGreaterThan(0);
    expect(sequence[1].pickup_distance_km).toBeGreaterThan(0);
  });

  it("returns an empty array for an empty order list", () => {
    expect(buildNextDaySequence(0, 0, [])).toEqual([]);
  });

  it("handles a single order", () => {
    const sequence = buildNextDaySequence(0, 0, [{ id: 1, plat: 0, plong: 1, dlat: 0, dlong: 2 }]);
    expect(sequence).toEqual([{ order_id: 1, pickup_distance_km: expect.any(Number) }]);
  });
});
