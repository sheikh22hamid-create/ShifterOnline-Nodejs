jest.mock("../../config/db", () => ({
  pkg_order: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  tbl_package: { findMany: jest.fn(), findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  pkg_order_stops: { createMany: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  $queryRaw: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../utils/geoDistance", () => ({
  ...jest.requireActual("../../utils/geoDistance"),
  getMultiStopDistanceKm: jest.fn().mockResolvedValue({ distanceKm: 12, durationMin: 30, source: "mock" }),
}));

const prisma = require("../../config/db");
const dispatchManager = require("../../services/dispatchManager");
const { createOrderCore } = require("../orderController");

const BASE = {
  uid: 1, category: "Tata Ace", deliveryTypeIds: [6], bookingType: 1,
  plat: "22.70", plong: "75.80", dlat: "22.75", dlong: "75.90", distance: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.app_settings.findFirst.mockResolvedValue(null);
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, sort_order: 1, min_charge: 50, per_km_charge: 10, title: "Standard", driver_per_percent: "90" }]);
  prisma.pkg_order.create.mockImplementation(({ data }) => Promise.resolve({ id: 321, ...data }));
});

describe("createOrderCore for a Customise Order (agreedFare / skipDispatch / customiseOrderId)", () => {
  it("stores the agreed fare, the commission on it and the link, and does not start the driver search", async () => {
    const out = await createOrderCore({ ...BASE, agreedFare: 1500, skipDispatch: true, customiseOrderId: 12 });
    expect(out.ok).toBe(true);
    const data = prisma.pkg_order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ total_dcharge: 1500, d_charge: 1500, customise_order_id: 12, commission: 10 });
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });

  it("keeps the agreed fare even when the order has extra stops (normally re-priced from the rate card)", async () => {
    const stops = [{ lat: 22.72, lng: 75.82, address: "S1" }];
    await createOrderCore({ ...BASE, stops, agreedFare: 1500, skipDispatch: true, customiseOrderId: 12 });
    expect(prisma.pkg_order.create.mock.calls[0][0].data).toMatchObject({ total_dcharge: 1500, d_charge: 1500 });
  });

  it("a normal order is unchanged: fare from the rate card, dispatch starts, no link", async () => {
    await createOrderCore(BASE);
    const data = prisma.pkg_order.create.mock.calls[0][0].data;
    expect(data.customise_order_id).toBeUndefined();
    expect(data.total_dcharge).not.toBe(1500);
    expect(dispatchManager.startDispatch).toHaveBeenCalled();
  });
});
