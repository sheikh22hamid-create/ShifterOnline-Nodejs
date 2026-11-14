jest.mock("../../config/db", () => ({
  guarantee_outside_candidate: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  booking_guarantee_audit: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const svc = require("../guaranteeQueueService");

describe("guaranteeQueueService - attachOffer trip details & distance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.guarantee_outside_candidate.findMany.mockResolvedValue([]);
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    prisma.pkg_order_stops.findMany.mockResolvedValue([]);
    prisma.booking_guarantee_audit.findMany.mockResolvedValue([]);
  });

  it("attaches pickup_title, drop_title, and road route distance when order has distance", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([
      {
        id: 101,
        paddress: "Asharfi Colony, Khajrana",
        daddress: "Near Main Road, Malviya Nagar",
        pickup_title: "Khajrana",
        drop_title: "Malviya Nagar",
        total_dcharge: 150,
        distance: 8.5,
        plat: "22.75",
        plong: "75.89",
        dlat: "22.72",
        dlong: "75.85",
        rid: 0,
      },
    ]);

    const res = await svc.attachOffer([{ id: 1, order_id: 101 }]);
    const order = res[0].order;
    expect(order.pickup_title).toBe("Khajrana");
    expect(order.drop_title).toBe("Malviya Nagar");
    expect(order.trip_distance_km).toBe(8.5);
    expect(order.trip_distance_text).toBe("8.5 KM");
    expect(order.trip_distance_kind).toBe("road");
  });

  it("calculates straight-line distance via haversine when order.distance is missing/0 but coordinates exist", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([
      {
        id: 102,
        paddress: "Point A",
        daddress: "Point B",
        pickup_title: null,
        drop_title: null,
        total_dcharge: 100,
        distance: 0,
        plat: "22.7196",
        plong: "75.8577",
        dlat: "22.7533",
        dlong: "75.8937",
        rid: 0,
      },
    ]);

    const res = await svc.attachOffer([{ id: 2, order_id: 102 }]);
    const order = res[0].order;
    expect(order.pickup_title).toBeNull();
    expect(order.drop_title).toBeNull();
    expect(order.trip_distance_km).toBeGreaterThan(0);
    expect(order.trip_distance_text).toMatch(/^\d+(\.\d+)? KM$/);
    expect(order.trip_distance_kind).toBe("straight_line");
  });

  it("returns null distance safely when coordinates and distance are both missing (never fabricated)", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([
      {
        id: 103,
        paddress: "Old order without coords",
        daddress: "Drop without coords",
        pickup_title: null,
        drop_title: null,
        total_dcharge: 50,
        distance: null,
        plat: null,
        plong: null,
        dlat: "",
        dlong: "",
        rid: 0,
      },
    ]);

    const res = await svc.attachOffer([{ id: 3, order_id: 103 }]);
    const order = res[0].order;
    expect(order.trip_distance_km).toBeNull();
    expect(order.trip_distance_text).toBeNull();
    expect(order.trip_distance_kind).toBeNull();
  });

  it("attaches assigned driver details when order.rid > 0", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([
      {
        id: 104,
        paddress: "Pickup 1",
        daddress: "Drop 1",
        pickup_title: "Area 1",
        drop_title: "Area 2",
        total_dcharge: 200,
        distance: 12.3,
        rid: 55,
      },
    ]);
    prisma.tbl_rider.findMany.mockResolvedValue([
      {
        id: 55,
        full_name: "Ramesh Sharma",
        fmobile: "9876543210",
        vehicle_no: "MP09AB1234",
        vehicle: "Tata Ace",
        status: 1,
        a_status: 1,
      },
    ]);

    const res = await svc.attachOffer([{ id: 4, order_id: 104 }]);
    expect(res[0].assigned_driver).toEqual({
      rider_id: 55,
      name: "Ramesh Sharma",
      mobile: "9876543210",
      vehicle_number: "MP09AB1234",
      vehicle_name: "Tata Ace",
      online: true,
    });
  });
});
