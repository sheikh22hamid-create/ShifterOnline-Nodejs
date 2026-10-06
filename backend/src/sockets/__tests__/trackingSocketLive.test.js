jest.mock("../../config/db", () => ({ tbl_rider: { update: jest.fn().mockResolvedValue({}) } }));
jest.mock("../adminSocket", () => ({ notifyLiveDriverPing: jest.fn() }));
jest.mock("../../services/dutyTrackingService", () => ({ recordDutyLocationPing: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const store = require("../../services/liveDriverPositions");
const { registerTrackingHandlers } = require("../trackingSocket");

function ping(payload) {
  let handler;
  const socket = { on: (name, fn) => { if (name === "driver:location_ping") handler = fn; }, data: {} };
  const io = { to: () => ({ emit: jest.fn() }) };
  registerTrackingHandlers(io, socket);
  handler(payload);
}

beforeEach(() => store._clear());

it("keeps every valid ping in the live store, not just the throttled DB write", () => {
  ping({ rider_id: 7, order_id: 1, lat: 22.7, lng: 75.8, heading: 45 });
  expect(store.get(7)).toMatchObject({ lat: 22.7, lng: 75.8, heading: 45 });
});
it("ignores an invalid ping", () => {
  ping({ rider_id: 7, lat: "x", lng: 75.8 });
  expect(store.get(7)).toBeNull();
});
