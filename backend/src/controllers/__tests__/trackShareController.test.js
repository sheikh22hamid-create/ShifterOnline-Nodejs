jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/receiverTrackMessage", () => ({ urlForBooker: jest.fn() }));

const { urlForBooker } = require("../../services/receiverTrackMessage");
const { customerTrackLink } = require("../trackShareController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = (r) => r.json.mock.calls[0][0];

beforeEach(() => jest.clearAllMocks());

describe("customerTrackLink", () => {
  it("returns the tracking url", async () => {
    urlForBooker.mockResolvedValue({ ok: true, url: "https://x/track/t" });
    const r = res();
    await customerTrackLink({ body: { uid: "7", order_id: 5 } }, r);
    expect(urlForBooker).toHaveBeenCalledWith({ orderId: 5, uid: 7 });
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body(r)).toMatchObject({ ResponseCode: "200", Result: "true", tracking_url: "https://x/track/t" });
  });
  it("requires uid and order_id", async () => {
    const r = res();
    await customerTrackLink({ body: { uid: 7 } }, r);
    expect(urlForBooker).not.toHaveBeenCalled();
    expect(body(r)).toMatchObject({ Result: "false", code: "VALIDATION" });
  });
  it("maps a refusal to a 200 envelope with the machine code", async () => {
    urlForBooker.mockResolvedValue({ ok: false, code: "FORBIDDEN", msg: "nope" });
    const r = res();
    await customerTrackLink({ body: { uid: 7, order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", Result: "false", code: "FORBIDDEN" });
  });
  it("turns unexpected errors into ResponseCode 500", async () => {
    urlForBooker.mockRejectedValue(new Error("db"));
    const r = res();
    await customerTrackLink({ body: { uid: 7, order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "500", Result: "false" });
  });
});
