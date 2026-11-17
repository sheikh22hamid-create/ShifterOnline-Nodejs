// Assign Driver popup: candidates near the pickup (any city) and the assign city check that goes with it.
jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn() } }));
jest.mock("../../services/dispatchManager", () => ({}));
jest.mock("../../services/pricingEngine", () => ({}));
jest.mock("../../services/pushNotifier", () => ({}));
jest.mock("../../sockets/adminSocket", () => ({}));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));
jest.mock("../../services/bookingGuaranteeService", () => ({}));
jest.mock("../../services/guaranteeQueueService", () => ({ assertExecutiveMayAssign: jest.fn() }));
jest.mock("../../services/orderAssignmentService", () => ({ assignRiderToOrder: jest.fn() }));
jest.mock("../../services/assignCandidatesService", () => ({ listCandidates: jest.fn(), mayAssignOtherCity: jest.fn() }));

const prisma = require("../../config/db");
const orderAssignment = require("../../services/orderAssignmentService");
const candidates = require("../../services/assignCandidatesService");
const { assignCandidates, assignRider } = require("../adminOrderController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const exec = { id: 12, role: "executive", city_id: "2" };
const order = { id: 1027, city_id: 2, category: "Bike" };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue(order);
});

describe("GET /admin/orders/:id/assign-candidates", () => {
  it("lists candidates for the order with the requested source and search", async () => {
    candidates.listCandidates.mockResolvedValue([{ id: 94 }]);
    const r = res();
    await assignCandidates({ params: { id: "1027" }, query: { source: "trial", search: "637" }, user: exec }, r);
    expect(candidates.listCandidates).toHaveBeenCalledWith(order, { source: "trial", search: "637" });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [{ id: 94 }] });
  });

  it("an order outside the executive's city is 403; a missing order 404", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order, city_id: 5 });
    let r = res();
    await assignCandidates({ params: { id: "1027" }, query: {}, user: exec }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    prisma.pkg_order.findUnique.mockResolvedValue(null);
    r = res();
    await assignCandidates({ params: { id: "1027" }, query: {}, user: exec }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(candidates.listCandidates).not.toHaveBeenCalled();
  });
});

describe("assignRider rider city check", () => {
  it("a driver of another city is allowed only when near the pickup", async () => {
    orderAssignment.assignRiderToOrder.mockResolvedValue({ ok: true, order: {}, pkg: {} });
    await assignRider({ params: { id: "1027" }, body: { rider_id: 94 }, user: exec }, res());
    const { isRiderForbidden } = orderAssignment.assignRiderToOrder.mock.calls[0][0];
    const otherCity = { id: 94, city_id: 1 };
    candidates.mayAssignOtherCity.mockReturnValue(true);
    expect(isRiderForbidden(otherCity)).toBe(false);
    candidates.mayAssignOtherCity.mockReturnValue(false);
    expect(isRiderForbidden(otherCity)).toBe(true);
    expect(isRiderForbidden({ id: 9, city_id: 2 })).toBe(false);
    candidates.mayAssignOtherCity.mockReturnValue(true);
    isRiderForbidden(otherCity);
    expect(candidates.mayAssignOtherCity).toHaveBeenLastCalledWith(order, otherCity, undefined);
  });
});
