jest.mock("../../config/db", () => ({
  booking_guarantee_case: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  booking_guarantee_audit: { create: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../guaranteeQueueSettings", () => ({ autoSearchActive: jest.fn() }));
jest.mock("../guaranteeOutsideCandidateService", () => ({ createLive: jest.fn(), getLive: jest.fn(), hasOffered: jest.fn(), hasOfferedRider: jest.fn(), supersedeLive: jest.fn() }));
jest.mock("../guaranteeQueueService", () => ({ dispatchWaiting: jest.fn() }));

const prisma = require("../../config/db");
const adminSocket = require("../../sockets/adminSocket");
const settings = require("../guaranteeQueueSettings");
const candidates = require("../guaranteeOutsideCandidateService");
const queue = require("../guaranteeQueueService");
const svc = require("../guaranteeOutsideSearch");

const openCase = { id: 1, order_id: 9, city_id: 3, status: "open", queue_state: "unassigned", deadline_at: new Date(Date.now() + 600000) };
const heldOrder = { id: 9, rid: 0, order_status: 0, o_status: "Pending", category: "Bike" };
const driver = { name: "Rakesh", mobile: "9876543210", vehicle_number: "MP09 AB 1234", vehicle_name: "Bike", fare: 120 };
const httpErr = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const audits = () => prisma.booking_guarantee_audit.create.mock.calls.map((c) => c[0].data.event);

let deps;
beforeEach(() => {
  jest.resetAllMocks();
  prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 }); // lease acquired / state writes
  prisma.booking_guarantee_case.findUnique.mockResolvedValue(openCase);
  prisma.pkg_order.findUnique.mockResolvedValue(heldOrder);
  settings.autoSearchActive.mockResolvedValue(true);
  candidates.getLive.mockResolvedValue(null);
  candidates.hasOffered.mockResolvedValue(false);
  candidates.hasOfferedRider.mockResolvedValue(false);
  candidates.createLive.mockResolvedValue({ created: true, row: { id: 5 } });
  deps = {
    sleep: jest.fn().mockResolvedValue(),
    lookupFn: jest.fn().mockResolvedValue({ driver, repeat: false }),
    registerFn: jest.fn().mockResolvedValue({ rider_id: 44, kind: "trial_created" }),
  };
});

describe("guessVehicleId", () => {
  const { guessVehicleId } = require("../outsideDriverService");
  it("maps the order category to a partner vehicle id", () => {
    expect(guessVehicleId("Bike")).toBe(133);
    expect(guessVehicleId("Tata Ace")).toBe(97);
    expect(guessVehicleId("Pickup 8ft")).toBe(91);
    expect(guessVehicleId("Tata 407")).toBe(1);
    expect(guessVehicleId("3 Wheeler 500kg")).toBe(126);
    expect(guessVehicleId("something else")).toBe(1139);
  });
});

describe("runSearch", () => {
  it("finds a driver, registers a trial rider once, stores the candidate and dispatches the queue", async () => {
    const out = await svc.runSearch(1, deps);
    expect(out).toEqual({ outcome: "candidate" });
    expect(deps.lookupFn).toHaveBeenCalledWith(expect.objectContaining({ orderId: 9, vehicleId: 133, adminId: null }));
    expect(deps.registerFn).toHaveBeenCalledTimes(1);
    expect(deps.registerFn).toHaveBeenCalledWith(expect.objectContaining({ orderId: 9, name: "Rakesh", mobile: "9876543210", vehicleNumber: "MP09 AB 1234", trialOrders: 1 }));
    expect(candidates.createLive).toHaveBeenCalledWith({ caseId: 1, orderId: 9, riderId: 44, driver });
    expect(queue.dispatchWaiting).toHaveBeenCalledWith(3);
    expect(audits()).toEqual(expect.arrayContaining(["outside_search_started", "outside_driver_found", "outside_trial_created"]));
  });

  it("skips a repeat or previously offered driver and keeps searching, sleeping the gap between lookups", async () => {
    deps.lookupFn
      .mockResolvedValueOnce({ driver, repeat: true })
      .mockResolvedValueOnce({ driver, repeat: false })
      .mockResolvedValueOnce({ driver: { ...driver, mobile: "9000000001" }, repeat: false });
    candidates.hasOffered.mockResolvedValueOnce(true).mockResolvedValue(false);
    const out = await svc.runSearch(1, deps);
    expect(out.outcome).toBe("candidate");
    expect(deps.lookupFn).toHaveBeenCalledTimes(3);
    expect(deps.registerFn).toHaveBeenCalledTimes(1);
    expect(deps.registerFn.mock.calls[0][0].mobile).toBe("9000000001");
    expect(deps.sleep).toHaveBeenCalledWith(10000);
  });

  it("skips a driver whose trial rider was already offered for this order, even if the mobile text differed", async () => {
    deps.lookupFn
      .mockResolvedValueOnce({ driver: { ...driver, mobile: "+919876543210" }, repeat: false })
      .mockResolvedValueOnce({ driver: { ...driver, mobile: "9000000003" }, repeat: false });
    deps.registerFn
      .mockResolvedValueOnce({ rider_id: 44, kind: "already_on_shifter" })
      .mockResolvedValueOnce({ rider_id: 45, kind: "trial_created" });
    candidates.hasOfferedRider.mockResolvedValueOnce(true).mockResolvedValue(false);
    const out = await svc.runSearch(1, deps);
    expect(out.outcome).toBe("candidate");
    expect(candidates.createLive).toHaveBeenCalledTimes(1);
    expect(candidates.createLive.mock.calls[0][0].riderId).toBe(45);
  });

  it("a lookup limit (429) ends as exhausted: state, audit, admin alert", async () => {
    deps.lookupFn.mockRejectedValue(httpErr(429, "Lookup limit reached for this order"));
    const out = await svc.runSearch(1, deps);
    expect(out).toEqual({ outcome: "exhausted" });
    expect(prisma.booking_guarantee_case.updateMany.mock.calls.some((c) => c[0].data.search_state === "exhausted")).toBe(true);
    expect(audits()).toContain("outside_search_exhausted");
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(9, 3, expect.stringContaining("#9"), expect.objectContaining({ kind: "outside_search_exhausted" }));
    expect(deps.registerFn).not.toHaveBeenCalled();
  });

  it("a gap or in-flight 429 is retried after the gap, not treated as exhausted", async () => {
    deps.lookupFn.mockRejectedValueOnce(httpErr(429, "Please wait a few seconds before trying again")).mockResolvedValueOnce({ driver, repeat: false });
    const out = await svc.runSearch(1, deps);
    expect(out.outcome).toBe("candidate");
    expect(deps.sleep).toHaveBeenCalledWith(10000);
  });

  it("a trial-registration failure is audited, creates no candidate and the search continues", async () => {
    deps.registerFn.mockRejectedValueOnce(new Error("trial create failed")).mockResolvedValueOnce({ rider_id: 44, kind: "trial_created" });
    deps.lookupFn.mockResolvedValueOnce({ driver, repeat: false }).mockResolvedValueOnce({ driver: { ...driver, mobile: "9000000002" }, repeat: false });
    const out = await svc.runSearch(1, deps);
    expect(out.outcome).toBe("candidate");
    expect(audits()).toContain("outside_trial_failed");
    expect(candidates.createLive).toHaveBeenCalledTimes(1);
  });

  it("stops without looking up when the case is closed, the order is taken, or the switch is off", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ ...openCase, status: "cancelled" });
    expect((await svc.runSearch(1, deps)).outcome).toBe("stopped");
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(openCase);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...heldOrder, rid: 77 });
    expect((await svc.runSearch(1, deps)).outcome).toBe("stopped");
    prisma.pkg_order.findUnique.mockResolvedValue(heldOrder);
    settings.autoSearchActive.mockResolvedValue(false);
    expect((await svc.runSearch(1, deps)).outcome).toBe("stopped");
    expect(deps.lookupFn).not.toHaveBeenCalled();
  });

  it("a 409 from lookup (order no longer held) stops the search", async () => {
    deps.lookupFn.mockRejectedValue(httpErr(409, "Order is already assigned or closed"));
    expect((await svc.runSearch(1, deps)).outcome).toBe("stopped");
  });

  it("returns busy when another worker holds the lease", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.runSearch(1, deps)).toEqual({ outcome: "busy" });
    expect(deps.lookupFn).not.toHaveBeenCalled();
  });

  it("does nothing more when a live candidate already exists", async () => {
    candidates.getLive.mockResolvedValue({ id: 5 });
    expect((await svc.runSearch(1, deps)).outcome).toBe("candidate");
    expect(deps.lookupFn).not.toHaveBeenCalled();
  });
});

describe("lease ownership", () => {
  it("does not register a trial driver or touch the lease when it was taken over during the lookup", async () => {
    // acquire ok, loop-top renew ok, then the renew after the lookup finds another worker's lease
    prisma.booking_guarantee_case.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });
    const out = await svc.runSearch(1, deps);
    expect(out.outcome).toBe("stopped");
    expect(deps.registerFn).not.toHaveBeenCalled();
    expect(candidates.createLive).not.toHaveBeenCalled();
    expect(audits()).not.toContain("outside_search_exhausted");
  });

  it("supersedes a just-created candidate when the case closed while the trial driver was being registered", async () => {
    candidates.supersedeLive = jest.fn().mockResolvedValue(1);
    prisma.booking_guarantee_case.findUnique
      .mockResolvedValueOnce(openCase) // after acquire
      .mockResolvedValueOnce(openCase) // loop top
      .mockResolvedValue({ ...openCase, status: "cancelled" }); // re-read after createLive
    const out = await svc.runSearch(1, deps);
    expect(out.outcome).toBe("stopped");
    expect(candidates.supersedeLive).toHaveBeenCalledWith(1, "case_closed");
    expect(queue.dispatchWaiting).not.toHaveBeenCalled();
  });
});

describe("acquireLease", () => {
  it("is a compare-and-swap on a free or expired lease and marks the case searching", async () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(await svc.acquireLease(1, now)).toBe(true);
    const call = prisma.booking_guarantee_case.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: 1, status: "open" });
    expect(JSON.stringify(call.where)).toContain("search_lease_until");
    expect(call.data.search_state).toBe("searching");
    expect(call.data.search_lease_until.getTime()).toBe(now.getTime() + 6 * 60 * 1000); // longer than 3 partner lookups of 70 s
  });
});

describe("sweep", () => {
  it("starts a worker only for open auto-mode cases with no live candidate", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([
      { ...openCase, id: 1 }, { ...openCase, id: 2, order_id: 10 }, { ...openCase, id: 3, order_id: 11, city_id: 4 },
    ]);
    settings.autoSearchActive.mockImplementation(async (city) => city === 3);
    candidates.getLive.mockImplementation(async (id) => (id === 2 ? { id: 8 } : null));
    const started = [];
    const n = await svc.sweep(new Date(), (id) => started.push(id));
    expect(started).toEqual([1]);
    expect(n).toBe(1);
  });
});
