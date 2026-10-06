const store = require("../liveDriverPositions");

beforeEach(() => store._clear());

it("returns the latest ping per driver", () => {
  store.record(7, 22.7, 75.8, 90, 1000);
  store.record(7, 22.8, 75.9, 180, 2000);
  expect(store.get(7)).toEqual({ lat: 22.8, lng: 75.9, heading: 180, at: 2000 });
  expect(store.get("7")).not.toBeNull();
});
it("returns null for an unknown driver", () => {
  expect(store.get(99)).toBeNull();
});
