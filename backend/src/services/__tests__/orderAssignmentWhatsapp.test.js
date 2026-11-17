jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  pkg_order: { count: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  order_status_history: { create: jest.fn() },
  $executeRaw: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../dispatchManager", () => ({ stopDispatch: jest.fn(), emitDirectAssign: jest.fn() }));
jest.mock("../pricingEngine", () => ({ priceForPackageId: jest.fn(), getActiveCustomerPlan: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn(() => ({ to: () => ({ emit: jest.fn() }) })) }));
jest.mock("../bookingGuaranteeService", () => ({ closeOnAssign: jest.fn() }));
jest.mock("../guaranteeQueueService", () => ({ recordAssignmentAction: jest.fn() }));
jest.mock("../freeBookingService", () => ({ recordAcceptance: jest.fn(), getViewForOrder: jest.fn() }));
jest.mock("../whatsappTrialSettings", () => ({ eligibility: jest.fn() }));
jest.mock("../../whatsapp/driverOrder/flow", () => ({ startOrder: jest.fn() }), { virtual: true });

const prisma = require("../../config/db");
const pricingEngine = require("../pricingEngine");
const settings = require("../whatsappTrialSettings");
const flow = require("../../whatsapp/driverOrder/flow");
const { assignRiderToOrder } = require("../orderAssignmentService");

const ORDER = { id: 901, rid: 0, order_status: 0, delivery_type: 5, uid: 3, distance: 4, radius_range: 1, extra_mile_charge: 0 };
const ACTOR = { id: 7, username: "exec" };
const base = (extra = {}) => ({ order: ORDER, riderId: 55, actor: ACTOR, ...extra });

describe("assignRiderToOrder channel", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 55, status: 1, a_status: 0 });
    prisma.pkg_order.count.mockResolvedValue(0);
    prisma.$executeRaw.mockResolvedValue(1);
    pricingEngine.priceForPackageId.mockResolvedValue({ pkg: { id: 5 }, fare: 100, commission: 10 });
    pricingEngine.getActiveCustomerPlan.mockResolvedValue(null);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, rid: 55, order_status: 1, o_status: "Processing" });
    settings.eligibility.mockResolvedValue({ eligible: true, reason: null });
  });

  const sqlOf = () => prisma.$executeRaw.mock.calls[0][0].join("?");
  const valuesOf = () => prisma.$executeRaw.mock.calls[0].slice(1);

  it("assigns an offline eligible trial rider over whatsapp and records the channel in the claim", async () => {
    const r = await assignRiderToOrder(base({ channel: "whatsapp" }));
    expect(r.ok).toBe(true);
    expect(sqlOf()).toContain("driver_channel");
    expect(valuesOf()).toContain("whatsapp");
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(flow.startOrder).toHaveBeenCalledWith(901);
  });

  it("keeps the offline refusal for the default app channel", async () => {
    const r = await assignRiderToOrder(base());
    expect(r).toEqual({ ok: false, status: 400, message: "Driver is currently offline" });
    expect(settings.eligibility).not.toHaveBeenCalled();
  });

  it("records app as the channel for a normal assign", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 55, status: 1, a_status: 1 });
    await assignRiderToOrder(base());
    expect(valuesOf()).toContain("app");
    expect(flow.startOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", "WhatsApp orders are switched off"],
    ["bot_offline", "WhatsApp bot is not connected"],
    ["not_trial", "WhatsApp mode is only for active Trial Drivers"],
  ])("refuses when ineligible (%s)", async (reason, message) => {
    settings.eligibility.mockResolvedValue({ eligible: false, reason });
    expect(await assignRiderToOrder(base({ channel: "whatsapp" }))).toEqual({ ok: false, status: 400, message });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("maps not_found to the existing 404", async () => {
    settings.eligibility.mockResolvedValue({ eligible: false, reason: "not_found" });
    expect(await assignRiderToOrder(base({ channel: "whatsapp" }))).toEqual({ ok: false, status: 404, message: "Driver not found" });
  });

  it("fails 500 when the eligibility check throws", async () => {
    settings.eligibility.mockRejectedValue(new Error("db"));
    expect(await assignRiderToOrder(base({ channel: "whatsapp" }))).toEqual({ ok: false, status: 500, message: "Could not check WhatsApp eligibility" });
  });

  it("rejects an unknown channel", async () => {
    expect(await assignRiderToOrder(base({ channel: "sms" }))).toEqual({ ok: false, status: 400, message: "Invalid channel" });
  });

  it("still succeeds when startOrder throws", async () => {
    flow.startOrder.mockImplementation(() => { throw new Error("boom"); });
    expect((await assignRiderToOrder(base({ channel: "whatsapp" }))).ok).toBe(true);
  });

  it("still succeeds when startOrder rejects", async () => {
    flow.startOrder.mockRejectedValue(new Error("boom"));
    expect((await assignRiderToOrder(base({ channel: "whatsapp" }))).ok).toBe(true);
  });
});
