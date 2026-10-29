jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../services/lowFareSettings", () => ({ isEnabled: jest.fn() }));
jest.mock("../../services/lowFareService", () => ({
  listForDriver: jest.fn(), countForDriver: jest.fn(), markSeen: jest.fn(), accept: jest.fn(),
}));

const settings = require("../../services/lowFareSettings");
const service = require("../../services/lowFareService");
const controller = require("../lowFareController");

const call = async (handler, body) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ body }, res);
  return res.json.mock.calls[0][0];
};

beforeEach(() => {
  jest.resetAllMocks();
  settings.isEnabled.mockResolvedValue(true);
});

describe("lowFareController", () => {
  it("answers Result:false for every call while the switch is off", async () => {
    settings.isEnabled.mockResolvedValue(false);
    for (const h of [controller.list, controller.count, controller.seen, controller.accept]) {
      expect(await call(h, { rider_id: 7, order_id: 1 })).toEqual({ Result: false, msg: "Low Fare Order is not available" });
    }
    expect(service.accept).not.toHaveBeenCalled();
  });

  it("needs a rider_id", async () => {
    expect(await call(controller.list, {})).toEqual({ Result: false, msg: "rider_id is required" });
  });

  it("lists orders with the unread count", async () => {
    service.listForDriver.mockResolvedValue([{ id: 1, unread: true }, { id: 2, unread: false }]);
    expect(await call(controller.list, { rider_id: 7 })).toEqual({ Result: true, orders: [{ id: 1, unread: true }, { id: 2, unread: false }], count: 1 });
  });

  it("counts, and marks orders seen", async () => {
    service.countForDriver.mockResolvedValue(3);
    expect(await call(controller.count, { rider_id: 7 })).toEqual({ Result: true, count: 3 });
    expect(await call(controller.seen, { rider_id: 7, order_ids: [1, 2] })).toEqual({ Result: true });
    expect(service.markSeen).toHaveBeenCalledWith(7, [1, 2]);
  });

  it("accept passes the plain refusal message through, including 'Already Attended'", async () => {
    service.accept.mockResolvedValueOnce({ ok: true, order_id: 5 }).mockResolvedValueOnce({ ok: false, msg: "Already Attended" });
    expect(await call(controller.accept, { rider_id: 7, order_id: 5 })).toEqual({ Result: true, order_id: 5 });
    expect(await call(controller.accept, { rider_id: 8, order_id: 5 })).toEqual({ Result: false, msg: "Already Attended" });
    expect(service.accept).toHaveBeenNthCalledWith(1, 5, 7);
  });

  it("turns an unexpected error into a plain failure", async () => {
    service.listForDriver.mockRejectedValue(new Error("db"));
    expect(await call(controller.list, { rider_id: 7 })).toEqual({ Result: false, msg: "Internal server error" });
  });
});
