// WhatsApp Trial Order, Task 8: admin endpoints for a WhatsApp order's status, the manual "next step" and a
// rider's WhatsApp eligibility. The WhatsApp modules are mocked: the controller must reach them lazily.
jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn() } }));
jest.mock("../../services/dispatchManager", () => ({}));
jest.mock("../../services/pricingEngine", () => ({}));
jest.mock("../../services/pushNotifier", () => ({}));
jest.mock("../../sockets/adminSocket", () => ({}));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));
jest.mock("../../services/bookingGuaranteeService", () => ({}));
jest.mock("../../whatsapp/driverOrder/flow", () => ({ statusForExecutive: jest.fn(), advanceAsExecutive: jest.fn() }));
jest.mock("../../services/whatsappTrialSettings", () => ({ eligibility: jest.fn() }));

const prisma = require("../../config/db");
const flow = require("../../whatsapp/driverOrder/flow");
const whatsappTrialSettings = require("../../services/whatsappTrialSettings");
const { whatsappStatus, whatsappStep, whatsappEligibility } = require("../adminOrderController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const exec = { id: 12, role: "executive", city_id: "3" };
const req = (o = {}) => ({ params: { id: "877" }, body: {}, user: exec, ...o });

beforeEach(() => {
  jest.resetAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 877, city_id: 3 });
});

describe("GET /admin/orders/:id/whatsapp-status", () => {
  it("returns the executive status", async () => {
    flow.statusForExecutive.mockResolvedValue({ channel: "whatsapp", step: "go_pickup" });
    const r = res();
    await whatsappStatus(req(), r);
    expect(flow.statusForExecutive).toHaveBeenCalledWith(877);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { channel: "whatsapp", step: "go_pickup" } });
  });

  it("an order in another city is forbidden; a missing order is 404", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 877, city_id: 4 });
    let r = res();
    await whatsappStatus(req(), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(flow.statusForExecutive).not.toHaveBeenCalled();

    prisma.pkg_order.findUnique.mockResolvedValue(null);
    r = res();
    await whatsappStatus(req(), r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
});

describe("POST /admin/orders/:id/whatsapp-step", () => {
  it("passes the otp and the admin; success -> 200", async () => {
    flow.advanceAsExecutive.mockResolvedValue({ ok: true, message: "Done", step: "loading", step_label: "Loading" });
    const r = res();
    await whatsappStep(req({ body: { otp: "4821" } }), r);
    expect(flow.advanceAsExecutive).toHaveBeenCalledWith({ orderId: 877, admin: exec, otp: "4821" });
    expect(r.json).toHaveBeenCalledWith({ success: true, message: "Done", data: { step: "loading", step_label: "Loading" } });
  });

  it("a refusal keeps its status and message", async () => {
    flow.advanceAsExecutive.mockResolvedValue({ ok: false, status: 409, message: "Invalid pickup OTP" });
    const r = res();
    await whatsappStep(req({ body: { otp: "1111" } }), r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json).toHaveBeenCalledWith({ success: false, message: "Invalid pickup OTP" });
  });

  it("an order in another city is forbidden", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 877, city_id: 4 });
    const r = res();
    await whatsappStep(req(), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(flow.advanceAsExecutive).not.toHaveBeenCalled();
  });
});

describe("GET /admin/riders/:id/whatsapp-eligibility", () => {
  it("returns eligibility(riderId)", async () => {
    whatsappTrialSettings.eligibility.mockResolvedValue({ eligible: true, reason: null, whatsapp_orders_done: 1 });
    const r = res();
    await whatsappEligibility(req({ params: { id: "55" } }), r);
    expect(whatsappTrialSettings.eligibility).toHaveBeenCalledWith(55);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { eligible: true, reason: null, whatsapp_orders_done: 1 } });
  });

  it("an invalid rider id is 400", async () => {
    const r = res();
    await whatsappEligibility(req({ params: { id: "x" } }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});
