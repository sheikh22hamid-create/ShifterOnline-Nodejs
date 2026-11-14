// Admin address edits change only the text, never the coordinates, so the stored Main Area
// title for that side is cleared (a stale title is worse than none). No geocode happens here.
jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn(), update: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/walletPrepaymentRefund", () => ({}));
jest.mock("../../services/referralPointsRefund", () => ({}));
jest.mock("../../services/dispatchManager", () => ({}));
jest.mock("../../services/pricingEngine", () => ({}));
jest.mock("../../services/pushNotifier", () => ({}));
jest.mock("../../sockets/adminSocket", () => ({ notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));
jest.mock("../../services/receiverTrackMessage", () => ({ syncReceiverPhone: jest.fn().mockResolvedValue({ rotated: false }) }));
jest.mock("../../services/receiverPayService", () => {
  class ReceiverPayError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  return { ReceiverPayError, changeReceiverPhone: jest.fn() };
});

const prisma = require("../../config/db");
const { update } = require("../adminOrderController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const req = (body) => ({ params: { id: "50" }, body, user: { id: 1, role: "superadmin" } });
const updateData = () => prisma.pkg_order.update.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue({
    id: 50,
    city_id: 1,
    o_status: "Processing",
    paddress: "Old Pickup, Khajrana",
    daddress: "Old Drop, Vijay Nagar",
    pickup_title: "Khajrana",
    drop_title: "Vijay Nagar",
    plats: "22.7", plongs: "75.9", dlats: "22.75", dlongs: "75.89",
  });
  prisma.pkg_order.update.mockResolvedValue({ id: 50 });
});

describe("adminOrderController.update - area titles", () => {
  it("clears pickup_title when paddress changes, leaving drop_title alone", async () => {
    await update(req({ paddress: "New Pickup Street" }), res());
    const data = updateData();
    expect(data.paddress).toBe("New Pickup Street");
    expect(data).toHaveProperty("pickup_title", null);
    expect(data).not.toHaveProperty("drop_title");
  });

  it("clears drop_title when daddress changes, leaving pickup_title alone", async () => {
    await update(req({ daddress: "New Drop Street" }), res());
    const data = updateData();
    expect(data).toHaveProperty("drop_title", null);
    expect(data).not.toHaveProperty("pickup_title");
  });

  it("clears both when both addresses change", async () => {
    await update(req({ paddress: "P2", daddress: "D2" }), res());
    const data = updateData();
    expect(data.pickup_title).toBeNull();
    expect(data.drop_title).toBeNull();
  });

  it("keeps titles when the submitted address equals the current one", async () => {
    await update(req({ paddress: "Old Pickup, Khajrana", daddress: "Old Drop, Vijay Nagar" }), res());
    const data = updateData();
    expect(data).not.toHaveProperty("pickup_title");
    expect(data).not.toHaveProperty("drop_title");
  });

  it("keeps titles for unrelated edits", async () => {
    await update(req({ pmobile: "9999999999", description: "fragile" }), res());
    const data = updateData();
    expect(data).not.toHaveProperty("pickup_title");
    expect(data).not.toHaveProperty("drop_title");
  });

  it("never touches coordinates", async () => {
    await update(req({ paddress: "P2", daddress: "D2" }), res());
    const data = updateData();
    for (const k of ["plats", "plongs", "dlats", "dlongs"]) expect(data).not.toHaveProperty(k);
  });
});
