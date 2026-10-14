jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn(), update: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../guaranteeQueueSettings", () => ({ getQueueSettings: jest.fn() }));
jest.mock("../orderSearchSettings", () => ({ getCitySettings: jest.fn() }));
jest.mock("../guaranteeQueueService", () => ({ endActiveAssignment: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../bookingGuaranteeService", () => ({ announceOpened: jest.fn().mockResolvedValue(undefined) }));

const prisma = require("../../config/db");
const queueSettings = require("../guaranteeQueueSettings");
const orderSearchSettings = require("../orderSearchSettings");
const dispatchManager = require("../dispatchManager");
const bookingGuarantee = require("../bookingGuaranteeService");
const svc = require("../guaranteeRecoveryService");

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue({ city_id: 3 });
  queueSettings.getQueueSettings.mockResolvedValue({ recoverOnDriverCancel: true });
  orderSearchSettings.getCitySettings.mockResolvedValue({ guaranteeEnabled: true, driverSearchSeconds: 60 });
});

describe("recoveryCityFor", () => {
  it("returns the city only when the order has one, the switch is on and the guarantee is on", async () => {
    expect(await svc.recoveryCityFor(50)).toBe(3);
  });
  it.each([
    ["no city on the order", () => prisma.pkg_order.findUnique.mockResolvedValue({ city_id: null })],
    ["order not found", () => prisma.pkg_order.findUnique.mockResolvedValue(null)],
    ["switch OFF", () => queueSettings.getQueueSettings.mockResolvedValue({ recoverOnDriverCancel: false })],
    ["guarantee OFF", () => orderSearchSettings.getCitySettings.mockResolvedValue({ guaranteeEnabled: false })],
    ["order read fails", () => prisma.pkg_order.findUnique.mockRejectedValue(new Error("db down"))],
    ["settings read fails", () => queueSettings.getQueueSettings.mockRejectedValue(new Error("db down"))],
  ])("returns null (fail closed) for %s", async (_label, arrange) => {
    arrange();
    expect(await svc.recoveryCityFor(50)).toBeNull();
  });
});

describe("clampSearchDeadline", () => {
  it("never lets a search outlive the case", () => {
    const caseDeadline = new Date("2026-10-14T10:00:00Z");
    expect(svc.clampSearchDeadline(new Date("2026-10-14T10:05:00Z"), caseDeadline).getTime()).toBe(caseDeadline.getTime());
    const earlier = new Date("2026-10-14T09:59:00Z");
    expect(svc.clampSearchDeadline(earlier, caseDeadline).getTime()).toBe(earlier.getTime());
    expect(svc.clampSearchDeadline(earlier, "2026-10-14T10:00:00Z").getTime()).toBe(earlier.getTime());
  });
});

describe("afterReopen", () => {
  const caseRow = { id: 1, order_id: 50, uid: 7, deadline_at: new Date(Date.now() + 5 * 60 * 1000) };
  it("tells the customer, restarts auto-search and announces the reopened case", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, city_id: 3, search_system: 1 });
    await svc.afterReopen({ orderId: 50, caseRow, cityId: 3 });
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:driver_unassigned", { order_id: "50" });
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 50 }), null);
    expect(bookingGuarantee.announceOpened).toHaveBeenCalledWith(caseRow, 3);
    expect(prisma.pkg_order.update).not.toHaveBeenCalled(); // System 1 has no search deadline
  });
  it("System 2: the new search deadline is clamped to the case deadline", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, city_id: 3, search_system: 2 });
    orderSearchSettings.getCitySettings.mockResolvedValue({ guaranteeEnabled: true, driverSearchSeconds: 3600 });
    await svc.afterReopen({ orderId: 50, caseRow, cityId: 3 });
    const written = prisma.pkg_order.update.mock.calls[0][0].data.search_deadline_at;
    expect(written.getTime()).toBe(new Date(caseRow.deadline_at).getTime());
  });
  it("never throws, even if dispatch or the announcement fail", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, city_id: 3, search_system: 1 });
    dispatchManager.startDispatch.mockRejectedValue(new Error("boom"));
    bookingGuarantee.announceOpened.mockRejectedValue(new Error("boom"));
    await expect(svc.afterReopen({ orderId: 50, caseRow, cityId: 3 })).resolves.toBeUndefined();
  });
});
