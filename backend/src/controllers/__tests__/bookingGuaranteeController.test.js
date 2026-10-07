jest.mock("../../services/bookingGuaranteeService", () => ({ quote: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const svc = require("../../services/bookingGuaranteeService");
const { quote } = require("../bookingGuaranteeController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => jest.clearAllMocks());

describe("bookingGuaranteeController.quote", () => {
  it("returns the amount for the selected packages", async () => {
    svc.quote.mockResolvedValue({ packageId: 20, amount: 100 });
    const r = res();
    await quote({ body: { package_ids: [10, 20] } }, r);
    expect(svc.quote).toHaveBeenCalledWith([10, 20]);
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: "true", amount: 100, package_id: 20 });
  });
  it.each([undefined, null, [], "10", {}])("rejects package_ids=%p with 400", async (bad) => {
    const r = res();
    await quote({ body: { package_ids: bad } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(svc.quote).not.toHaveBeenCalled();
  });
  it("rejects more than 20 package_ids with 400 and never calls the service", async () => {
    const r = res();
    await quote({ body: { package_ids: Array.from({ length: 21 }, (_, i) => i + 1) } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "400", Result: "false", ResponseMsg: "package_ids must have at most 20 entries" });
    expect(svc.quote).not.toHaveBeenCalled();
  });
  it("exactly 20 package_ids passes through", async () => {
    svc.quote.mockResolvedValue({ packageId: 1, amount: 5 });
    const r = res();
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    await quote({ body: { package_ids: ids } }, r);
    expect(svc.quote).toHaveBeenCalledWith(ids);
  });
  it("a service failure is a 500, not a crash", async () => {
    svc.quote.mockRejectedValue(new Error("db"));
    const r = res();
    await quote({ body: { package_ids: [1] } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});
