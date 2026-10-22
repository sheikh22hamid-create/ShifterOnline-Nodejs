jest.mock("../../config/db", () => ({
  guarantee_outside_candidate: { findFirst: jest.fn() },
  booking_guarantee_case: { findUnique: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../orderAssignmentService", () => ({ assignRiderToOrder: jest.fn() }));

const prisma = require("../../config/db");
const adminSocket = require("../../sockets/adminSocket");
const { assignRiderToOrder } = require("../orderAssignmentService");
const auto = require("../trialDriverAutoAssign");

const ORDER = { id: 877, city_id: 4, rid: 0 };

describe("trialDriverAutoAssign.autoAssignIfOffered", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.guarantee_outside_candidate.findFirst.mockResolvedValue({ case_id: 11, order_id: 877, rider_id: 55, name: "Sultan" });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 11, status: "open" });
    prisma.pkg_order.findUnique.mockResolvedValue(ORDER);
  });

  it("does nothing for a rider that is not the live Trial Driver candidate", async () => {
    prisma.guarantee_outside_candidate.findFirst.mockResolvedValue(null);
    expect(await auto.autoAssignIfOffered(55)).toEqual({ assigned: false, reason: "not_offered" });
    expect(assignRiderToOrder).not.toHaveBeenCalled();
  });

  it("assigns the held order as the system and closes the case with the auto event", async () => {
    assignRiderToOrder.mockResolvedValue({ ok: true, order: ORDER });
    expect(await auto.autoAssignIfOffered(55)).toEqual({ assigned: true });
    const args = assignRiderToOrder.mock.calls[0][0];
    expect(args).toMatchObject({ order: ORDER, riderId: 55, closeAdminId: null, closeEvent: "trial_driver_auto_assigned" });
    expect(args.actor).toEqual({ id: 0, username: "system" });
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(877, 4, expect.stringContaining("assigned automatically"), expect.objectContaining({ kind: "trial_driver_auto_assigned" }));
  });

  it("skips a case that is no longer open", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 11, status: "assigned" });
    expect((await auto.autoAssignIfOffered(55)).reason).toBe("case_closed");
    expect(assignRiderToOrder).not.toHaveBeenCalled();
  });

  it("alerts the executive when assignment fails for a real reason, leaving the manual button available", async () => {
    assignRiderToOrder.mockResolvedValue({ ok: false, status: 400, message: "Driver is not approved" });
    expect((await auto.autoAssignIfOffered(55)).assigned).toBe(false);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(877, 4, expect.stringContaining("Assign it manually"), expect.objectContaining({ kind: "trial_driver_auto_assign_failed" }));
  });

  it("stays quiet when the order was simply taken by someone else (409)", async () => {
    assignRiderToOrder.mockResolvedValue({ ok: false, status: 409, message: "Order was just taken or cancelled — refresh and retry" });
    await auto.autoAssignIfOffered(55);
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    prisma.guarantee_outside_candidate.findFirst.mockRejectedValue(new Error("db down"));
    expect(await auto.autoAssignIfOffered(55)).toEqual({ assigned: false, reason: "error" });
  });
});

describe("trialDriverAutoAssign.scheduleOnOnline", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    prisma.guarantee_outside_candidate.findFirst.mockResolvedValue(null);
  });
  afterEach(() => jest.useRealTimers());

  it("checks after the delay, only for a rider that is now online", async () => {
    auto.scheduleOnOnline({ id: 55, a_status: 0 });
    jest.advanceTimersByTime(auto.AUTO_ASSIGN_DELAY_MS + 10);
    expect(prisma.guarantee_outside_candidate.findFirst).not.toHaveBeenCalled();

    auto.scheduleOnOnline({ id: 55, a_status: 1 });
    expect(prisma.guarantee_outside_candidate.findFirst).not.toHaveBeenCalled();
    jest.advanceTimersByTime(auto.AUTO_ASSIGN_DELAY_MS + 10);
    expect(prisma.guarantee_outside_candidate.findFirst).toHaveBeenCalledTimes(1);
  });
});
