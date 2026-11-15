jest.mock("../../config/db", () => ({
  pkg_order: { create: jest.fn() },
  tbl_package: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  pkg_order_stops: { createMany: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  $queryRaw: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn() }));
jest.mock("../../services/serviceAreaService", () => ({ validateBooking: jest.fn(), validateLocation: jest.fn(), SERVICE_AREA_ERRORS: {} }));
jest.mock("../../services/settlementService", () => ({ findBlockingSettlement: jest.fn().mockResolvedValue(null) }));
jest.mock("../../services/gstService", () => ({ resolveStored: jest.fn(), attachToOrder: jest.fn() }));

const prisma = require("../../config/db");
const gstService = require("../../services/gstService");
const pricingEngine = require("../../services/pricingEngine");
const { createOrderCore } = require("../orderController");

const BASE = {
  uid: 7, category: "Three Wheeler", deliveryTypeIds: [6], bookingType: 1,
  plat: "22.70", plong: "75.80", dlat: "23.18", dlong: "75.78", distance: 5, totalDcharge: 100, dCharge: 100,
};
const DETAILS = { gstin: "27AAPFU0939F1ZV", legal_name: "ABC TRADERS PRIVATE LIMITED", state: "Maharashtra" };

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(pricingEngine, "getActiveCustomerPlan").mockResolvedValue(null);
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, cat_id: 3, sort_order: 1, min_charge: 500, per_km_charge: 40, title: "Model 1", driver_per_percent: "90" }]);
  prisma.app_settings.findFirst.mockResolvedValue(null);
  prisma.$queryRaw.mockResolvedValue([]);
  prisma.pkg_order.create.mockImplementation(({ data }) => Promise.resolve({ id: 501, ...data }));
  require("../../services/serviceAreaService").validateBooking.mockResolvedValue({ ok: true });
  require("../../services/dispatchManager").startDispatch.mockResolvedValue(undefined);
  gstService.attachToOrder.mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe("optional GST at booking", () => {
  it("a GSTIN the customer already verified is saved on the order and its details are snapshotted", async () => {
    gstService.resolveStored.mockResolvedValue(DETAILS);
    const out = await createOrderCore({ ...BASE, gstNumber: " 27aapfu0939f1zv " });
    expect(out.ok).toBe(true);
    expect(gstService.resolveStored).toHaveBeenCalledWith(7, " 27aapfu0939f1zv ");
    expect(prisma.pkg_order.create.mock.calls[0][0].data.gst_number).toBe("27AAPFU0939F1ZV");
    expect(gstService.attachToOrder).toHaveBeenCalledWith(501, 7, DETAILS);
  });

  it("a GSTIN that was never verified is simply ignored: the booking goes through without GST details", async () => {
    gstService.resolveStored.mockResolvedValue(null);
    const out = await createOrderCore({ ...BASE, gstNumber: "27AAPFU0939F1ZV" });
    expect(out.ok).toBe(true);
    expect(prisma.pkg_order.create.mock.calls[0][0].data).not.toHaveProperty("gst_number");
    expect(gstService.attachToOrder).not.toHaveBeenCalled();
  });

  it("no GSTIN at all: nothing GST-related runs (GST is optional for everyone)", async () => {
    const out = await createOrderCore({ ...BASE });
    expect(out.ok).toBe(true);
    expect(gstService.resolveStored).not.toHaveBeenCalled();
    expect(gstService.attachToOrder).not.toHaveBeenCalled();
    expect(prisma.pkg_order.create.mock.calls[0][0].data).not.toHaveProperty("gst_number");
  });

  it("a GST lookup that fails never fails the booking, and the fare is the same either way", async () => {
    gstService.resolveStored.mockRejectedValue(new Error("db down"));
    const withGst = await createOrderCore({ ...BASE, gstNumber: "27AAPFU0939F1ZV" });
    expect(withGst.ok).toBe(true);
    const withoutGst = await createOrderCore({ ...BASE });
    const [a, b] = prisma.pkg_order.create.mock.calls.map((c) => c[0].data);
    expect(a.total_dcharge).toBe(b.total_dcharge);
    expect(a.d_charge).toBe(b.d_charge);
    expect(withoutGst.ok).toBe(true);
  });
});
