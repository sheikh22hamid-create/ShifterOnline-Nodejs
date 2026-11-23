jest.mock("../porterQuoteService", () => ({
  anchorFromOrder: (o) => (o && o.porter_quote && Number(o.porter_quote.fare) > 0 ? { fare: Number(o.porter_quote.fare) } : null),
  anchorForNewRoute: jest.fn(),
}));

const { anchorForNewRoute } = require("../porterQuoteService");
const { newRouteAnchor, anchorArgs } = require("../orderPorterAnchor");

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

test("a failure keeps the order's current anchor (never drops to the rate card)", async () => {
  anchorForNewRoute.mockRejectedValue(new Error("boom"));
  expect(await newRouteAnchor(order, route)).toEqual({ fare: 300 });
});

test("anchorArgs appends [null, null, anchor] only when anchored", () => {
  expect(anchorArgs(null)).toEqual([]);
  expect(anchorArgs({ fare: 1 })).toEqual([null, null, { fare: 1 }]);
});
