jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../services/lowFareService", () => ({
  listForDriver: jest.fn(), countForDriver: jest.fn(), markSeen: jest.fn(), accept: jest.fn(),
}));

const service = require("../../services/lowFareService");
const controller = require("../lowFareController");

const call = async (handler, body) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ body }, res);
  return res.json.mock.calls[0][0];
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("lowFareController", () => {
  it("keeps serving already-booked orders: the switch only stops new bookings, so list, count, seen and accept never consult it", async () => {
    service.listForDriver.mockResolvedValue([]);
    service.countForDriver.mockResolvedValue(0);
    service.accept.mockResolvedValue({ ok: true, order_id: 1 });
    expect((await call(controller.list, { rider_id: 7 })).Result).toBe(true);
    expect((await call(controller.count, { rider_id: 7 })).Result).toBe(true);
    expect((await call(controller.seen, { rider_id: 7, order_ids: [1] })).Result).toBe(true);
    expect((await call(controller.accept, { rider_id: 7, order_id: 1 })).Result).toBe(true);
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
