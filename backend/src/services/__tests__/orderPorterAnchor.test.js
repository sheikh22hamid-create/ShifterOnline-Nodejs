jest.mock("../porterQuoteService", () => ({
  anchorFromOrder: (o) => (o && o.porter_quote && Number(o.porter_quote.fare) > 0 ? { fare: Number(o.porter_quote.fare) } : null),
  anchorForNewRoute: jest.fn(),
}));

const { anchorForNewRoute } = require("../porterQuoteService");
const { Prisma } = require("@prisma/client");
const { newRouteAnchor, anchorArgs, porterQuoteUpdate } = require("../orderPorterAnchor");

const order = { id: 1, porter_quote: { fare: 300 } };
const route = { pickup: { lat: "22.7", lng: "75.8" }, drop: { lat: 22.8, lng: 75.9 }, stops: [{ lat: "22.75", lng: "75.85", id: 4 }], newDistanceKm: "12" };

beforeEach(() => jest.clearAllMocks());

test("unanchored order -> null without asking for a new anchor", async () => {
  expect(await newRouteAnchor({ id: 1, porter_quote: null }, route)).toBeNull();
  expect(anchorForNewRoute).not.toHaveBeenCalled();
});

test("normalises the route to numbers and returns the new anchor", async () => {
  anchorForNewRoute.mockResolvedValue({ fare: 360, scaled: true });
  expect(await newRouteAnchor(order, route)).toEqual({ fare: 360, scaled: true });
  expect(anchorForNewRoute).toHaveBeenCalledWith(order, {
    pickup: { lat: 22.7, lng: 75.8 }, drop: { lat: 22.8, lng: 75.9 }, stops: [{ lat: 22.75, lng: 75.85 }], newDistanceKm: 12,
  });
});

test("fails closed: a thrown error or no new anchor -> null (rate card), never the old anchor", async () => {
  anchorForNewRoute.mockRejectedValue(new Error("boom"));
  expect(await newRouteAnchor(order, route)).toBeNull();
  anchorForNewRoute.mockResolvedValue(null);
  expect(await newRouteAnchor(order, route)).toBeNull();
});

test("porterQuoteUpdate: untouched for unanchored, new anchor when re-anchored, DbNull when the anchor is lost", () => {
  expect(porterQuoteUpdate({ porter_quote: null }, null)).toEqual({});
  expect(porterQuoteUpdate({}, { fare: 5 })).toEqual({});
  expect(porterQuoteUpdate(order, { fare: 360 })).toEqual({ porter_quote: { fare: 360 } });
  expect(porterQuoteUpdate(order, null).porter_quote).toBe(Prisma.DbNull);
});

test("anchorArgs appends [null, null, anchor] only when anchored", () => {
  expect(anchorArgs(null)).toEqual([]);
  expect(anchorArgs({ fare: 1 })).toEqual([null, null, { fare: 1 }]);
});

describe("precomputeNewRouteAnchor / lockedRouteAnchor", () => {
  const { precomputeNewRouteAnchor, lockedRouteAnchor } = require("../orderPorterAnchor");
  const row = { id: 1, plat: "22.7", plong: "75.8", dlat: "22.8", dlong: "75.9", distance: 10, extra_mile_charge: 0, porter_quote: { fare: 300 } };
  const r = { pickup: { lat: 22.7, lng: 75.8 }, drop: { lat: 22.9, lng: 75.9 }, stops: [], newDistanceKm: 12 };

  test("unanchored order: no route computation, null", async () => {
    const compute = jest.fn();
    expect(await precomputeNewRouteAnchor({ ...row, porter_quote: null }, compute)).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  test("unchanged locked row -> precomputed anchor and route", async () => {
    anchorForNewRoute.mockResolvedValue({ fare: 360 });
    const pre = await precomputeNewRouteAnchor(row, async () => r);
    expect(lockedRouteAnchor(pre, { ...row })).toEqual({ matched: true, anchor: { fare: 360 }, route: r });
  });

  test("changed locked row, changed extra, or no precompute -> fail closed", async () => {
    anchorForNewRoute.mockResolvedValue({ fare: 360 });
    const pre = await precomputeNewRouteAnchor(row, async () => r, ["a"]);
    const closed = { matched: false, anchor: null, route: null };
    expect(lockedRouteAnchor(pre, { ...row, dlat: "23.0" }, ["a"])).toEqual(closed);
    expect(lockedRouteAnchor(pre, { ...row, porter_quote: { fare: 310 } }, ["a"])).toEqual(closed);
    expect(lockedRouteAnchor(pre, row, ["b"])).toEqual(closed);
    expect(lockedRouteAnchor(null, row)).toEqual(closed);
    expect(lockedRouteAnchor(pre, { ...row, porter_quote: null }, ["a"])).toEqual(closed);
  });

  test("a throwing route computation -> null", async () => {
    expect(await precomputeNewRouteAnchor(row, async () => { throw new Error("maps down"); })).toBeNull();
  });
});
