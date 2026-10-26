jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  booking_guarantee_case: { findUnique: jest.fn() },
  booking_guarantee_audit: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  $queryRaw: jest.fn(),
}));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/assignDefaultDeliveryTypes", () => ({ assignDefaultDeliveryTypes: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const adminSocket = require("../../sockets/adminSocket");
const { assignDefaultDeliveryTypes } = require("../../utils/assignDefaultDeliveryTypes");
const svc = require("../outsideDriverService");

const FOUND = {
  step: "DRIVER_FOUND",
  data: { driver: { driverName: "ANKIT BARFA", vehicleNumber: "MP-09-US-7097", contactNumber: "09340352904", vehicleDisplayName: "Scooter", fare: 98 }, fareDetails: { vehicleId: 133 } },
};
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const streamResp = (text, ok = true, status = 200) => ({
  ok, status,
  body: (async function* () { const b = Buffer.from(text); yield b.subarray(0, 17); yield b.subarray(17); })(),
});
const fetchOf = (...texts) => { const f = jest.fn(); texts.forEach((t) => f.mockResolvedValueOnce(streamResp(t))); return f; };

const ORDER = { id: 5, rid: 0, order_status: 0, o_status: "Pending", plat: "22.75", plong: "75.89", dlat: "22.71", dlong: "75.85", pick_name: "A", drop_name: "B" };
beforeEach(() => {
  jest.clearAllMocks();
  svc.resetCatalogCache();
  prisma.pkg_order.findUnique.mockResolvedValue(ORDER);
  prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 9, status: "open" });
  prisma.booking_guarantee_audit.findMany.mockResolvedValue([]);
  prisma.booking_guarantee_audit.create.mockResolvedValue({});
});

describe("parseSseEvent / driverFromEvent", () => {
  it("parses data lines and ignores junk", () => {
    expect(svc.parseSseEvent('data: {"step":"INIT"}')).toEqual({ step: "INIT" });
    expect(svc.parseSseEvent("data: nope")).toBeNull();
    expect(svc.parseSseEvent(": keepalive")).toBeNull();
  });
  it("needs a contact number to count as a driver", () => {
    expect(svc.driverFromEvent({ data: { driver: { driverName: "x" } } })).toBeNull();
    expect(svc.driverFromEvent(FOUND)).toMatchObject({ name: "ANKIT BARFA", mobile: "09340352904", vehicle_number: "MP-09-US-7097", fare: 98 });
  });
});

describe("vehicleFamily", () => {
  it("classifies Shifter categories and the partner's driver vehicle names alike", () => {
    expect(["E loader", "E Loader"].map(svc.vehicleFamily)).toEqual(["e_loader", "e_loader"]);
    expect(["Bike", "2 Wheeler", "Two wheeler"].map(svc.vehicleFamily)).toEqual(["bike", "bike", "bike"]);
    expect(svc.vehicleFamily("Scooter")).toBe("scooter");
    expect(["3 wheeler", "3 Wheeler"].map(svc.vehicleFamily)).toEqual(["three_wheeler", "three_wheeler"]);
    expect(["Mini 3W", "Mini 3-Wheeler"].map(svc.vehicleFamily)).toEqual(["mini_3w", "mini_3w"]);
    expect(["4 wheeler", "Tata Ace"].map(svc.vehicleFamily)).toEqual(["four_wheeler", "four_wheeler"]);
    expect(svc.vehicleFamily("Passenger Vehicle")).toBe("passenger");
    expect(svc.vehicleFamily("")).toBeNull();
  });
});

describe("lookup", () => {
  it("drops a driver whose real vehicle is not the order's vehicle type", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, category: "3 wheeler" });
    const eLoader = { ...FOUND, data: { ...FOUND.data, driver: { ...FOUND.data.driver, vehicleDisplayName: "E Loader" } } };
    expect(await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: fetchOf(sse([eLoader])) })).toMatchObject({ driver: null, reason: "vehicle_mismatch" });
    const ok = { ...FOUND, data: { ...FOUND.data, driver: { ...FOUND.data.driver, vehicleDisplayName: "3 Wheeler" } } };
    expect((await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: fetchOf(sse([ok])) })).driver).toBeTruthy();
  });

  it("drops a driver the partner booked on a different vehicle than requested", async () => {
    const wrong = { ...FOUND, data: { ...FOUND.data, fareDetails: { vehicleId: 1139 } } };
    expect(await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: fetchOf(sse([wrong, { step: "COMPLETED" }])) })).toMatchObject({ driver: null, reason: "vehicle_mismatch" });
    const assignedElsewhere = { ...FOUND, data: { driver: { ...FOUND.data.driver, vehicleId: 1139 }, fareDetails: { vehicleId: 133 } } };
    expect(await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: fetchOf(sse([assignedElsewhere])) })).toMatchObject({ driver: null, reason: "vehicle_mismatch" });
    const unknown = { ...FOUND, data: { driver: FOUND.data.driver } };
    expect(await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: fetchOf(sse([unknown])) })).toMatchObject({ driver: null, reason: "vehicle_mismatch" });
  });

  it("returns the driver, reads the stream to its end, and audits the lookup", async () => {
    const f = fetchOf(sse([{ step: "INIT" }, FOUND, { step: "CANCELLING" }, { step: "COMPLETED" }]));
    const out = await svc.lookup({ orderId: 5, vehicleId: 133, adminId: 1, fetchImpl: f });
    expect(out.driver).toMatchObject({ name: "ANKIT BARFA", mobile: "09340352904" });
    expect(out.attempts).toBe(1);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ vehicleId: 133, pickup: { lat: 22.75, lng: 75.89 }, drop: { lat: 22.71, lng: 75.85 } });
    expect(prisma.booking_guarantee_audit.create.mock.calls[0][0].data).toMatchObject({ case_id: 9, order_id: 5, event: "outside_driver_lookup", admin_id: 1 });
  });

  it("reports no driver when the stream ends without one", async () => {
    const out = await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: fetchOf(sse([{ step: "INIT" }, { step: "COMPLETED" }])) });
    expect(out).toMatchObject({ driver: null, reason: "no_driver_found" });
  });

  it("reports api trouble instead of throwing", async () => {
    const f = jest.fn().mockRejectedValue(new Error("boom"));
    expect(await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: f })).toMatchObject({ driver: null, reason: "api_unreachable" });
    const bad = jest.fn().mockResolvedValue(streamResp("", false, 502));
    expect(await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: bad })).toMatchObject({ driver: null, reason: "api_status_502" });
  });

  it("re-asks when the same driver comes back, then flags the repeat", async () => {
    prisma.booking_guarantee_audit.findMany.mockResolvedValue([{ created_at: new Date(Date.now() - 60000), meta: JSON.stringify({ vehicle_number: "MP-09-US-7097" }) }]);
    const same = sse([FOUND, { step: "COMPLETED" }]);
    const other = sse([{ step: "DRIVER_FOUND", data: { driver: { driverName: "NEW", vehicleNumber: "MP-09-ZZ-1", contactNumber: "111" }, fareDetails: { vehicleId: 133 } } }]);
    const f = fetchOf(same, other);
    const out = await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(out.driver.name).toBe("NEW");
    expect(out.repeat).toBe(false);
    const f2 = fetchOf(same, same, same);
    const out2 = await svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: f2 });
    expect(f2).toHaveBeenCalledTimes(3);
    expect(out2.repeat).toBe(true);
  });

  it.each([
    ["unsupported vehicle", () => {}, 999, 400],
    ["order gone", () => prisma.pkg_order.findUnique.mockResolvedValue(null), 133, 404],
    ["already assigned", () => prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, rid: 3 }), 133, 409],
    ["no open guarantee case", () => prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 9, status: "resolved_assigned" }), 133, 409],
    ["too soon after the last lookup", () => prisma.booking_guarantee_audit.findMany.mockResolvedValue([{ created_at: new Date(), meta: "{}" }]), 133, 429],
    ["lookup cap reached", () => prisma.booking_guarantee_audit.findMany.mockResolvedValue(Array.from({ length: 8 }, () => ({ created_at: new Date(Date.now() - 600000), meta: "{}" }))), 133, 429],
    ["bad coordinates", () => prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, plat: "" }), 133, 422],
  ])("rejects: %s", async (_n, arrange, vehicleId, status) => {
    arrange();
    const f = jest.fn();
    await expect(svc.lookup({ orderId: 5, vehicleId, fetchImpl: f })).rejects.toMatchObject({ statusCode: status });
    expect(f).not.toHaveBeenCalled();
  });

  it("blocks a second lookup for the same order while one is running", async () => {
    let release;
    const slow = jest.fn().mockImplementation(() => new Promise((r) => { release = () => r(streamResp(sse([{ step: "COMPLETED" }]))); }));
    const first = svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: slow });
    await new Promise((r) => setImmediate(r));
    await expect(svc.lookup({ orderId: 5, vehicleId: 133, fetchImpl: jest.fn() })).rejects.toMatchObject({ statusCode: 429 });
    release();
    await first;
  });
});

describe("registerTrial", () => {
  const HELD = { ...ORDER, city_id: 1, category: "E loader" };
  const args = { orderId: 5, name: " Ankit ", mobile: "09340352904", vehicleNumber: "MP-09-US-7097", adminId: 2 };
  beforeEach(() => {
    prisma.pkg_order.findUnique.mockResolvedValue(HELD);
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    prisma.tbl_rider.create.mockResolvedValue({ id: 77, a_status: 0 });
  });

  it("creates a trial rider in the order's city, normalising the 0-prefixed mobile, and links it to the order", async () => {
    const out = await svc.registerTrial(args);
    expect(out).toEqual({ rider_id: 77, kind: "trial_created", online: false });
    expect(prisma.tbl_rider.create.mock.calls[0][0].data).toMatchObject({
      fmobile: "9340352904", full_name: "Ankit", vehicle: "E loader", city_id: 1, trial_status: "active", trial_orders_allowed: 1, vehicle_no: "MP-09-US-7097",
    });
    expect(assignDefaultDeliveryTypes).toHaveBeenCalledWith(77);
    const audit = prisma.booking_guarantee_audit.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ event: "outside_driver_registered", order_id: 5, admin_id: 2 });
    expect(audit.meta.startsWith('{"rider_id":77,')).toBe(true);
  });

  it("leaves a driver who is already active on Shifter untouched", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 8, city_id: 1, trial_status: "none", verification_status: "approved", status: 1, a_status: 1 });
    const out = await svc.registerTrial(args);
    expect(out).toEqual({ rider_id: 8, kind: "already_on_shifter", online: true });
    expect(prisma.tbl_rider.create).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("activates the trial for an existing unapproved rider", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 9, city_id: 1, trial_status: "none", verification_status: "pending", status: 1 });
    prisma.tbl_rider.update.mockResolvedValue({ id: 9, a_status: 0 });
    expect((await svc.registerTrial({ ...args, trialOrders: 3 })).kind).toBe("trial_activated");
    expect(prisma.tbl_rider.update.mock.calls[0][0].data).toMatchObject({ trial_status: "active", trial_orders_allowed: 3, trial_orders_completed: 0 });
  });

  it.each([
    ["blank name", { name: " " }, () => {}, 400],
    ["bad mobile", { mobile: "12345" }, () => {}, 400],
    ["too many trial orders", { trialOrders: 9 }, () => {}, 400],
    ["driver in another city", {}, () => prisma.tbl_rider.findFirst.mockResolvedValue({ id: 1, city_id: 2 }), 409],
    ["order no longer held", {}, () => prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 9, status: "resolved_assigned" }), 409],
  ])("rejects: %s", async (_n, over, arrange, status) => {
    arrange();
    await expect(svc.registerTrial({ ...args, ...over })).rejects.toMatchObject({ statusCode: status });
    expect(prisma.tbl_rider.create).not.toHaveBeenCalled();
  });
});

describe("onboardStatus", () => {
  it("reports online only for a driver onboarded for this order", async () => {
    prisma.booking_guarantee_audit.findFirst.mockResolvedValue({ id: 1 });
    prisma.tbl_rider.findUnique.mockResolvedValue({ a_status: 1, status: 1 });
    prisma.pkg_order.findUnique.mockResolvedValue({ rid: 0, o_status: "Pending" });
    expect(await svc.onboardStatus({ orderId: 5, riderId: "77" })).toEqual({ online: true, order_open: true });
    expect(prisma.booking_guarantee_audit.findFirst.mock.calls[0][0].where.meta).toEqual({ startsWith: '{"rider_id":77,' });
  });
  it("refuses a rider that was not onboarded for the order", async () => {
    prisma.booking_guarantee_audit.findFirst.mockResolvedValue(null);
    await expect(svc.onboardStatus({ orderId: 5, riderId: 77 })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("notifyIfAwaited", () => {
  it("alerts admins for each held order the rider was onboarded for", async () => {
    prisma.$queryRaw.mockResolvedValue([{ order_id: 5 }, { order_id: 6 }]);
    await svc.notifyIfAwaited({ id: 77, city_id: 1 });
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledTimes(2);
    expect(adminSocket.notifyDispatchAlert.mock.calls[0].slice(0, 2)).toEqual([5, 1]);
  });
  it("never throws when the lookup fails", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("db"));
    await expect(svc.notifyIfAwaited({ id: 77, city_id: 1 })).resolves.toBeUndefined();
  });
});

describe("getVehicles", () => {
  const okJson = (vehicles) => jest.fn().mockResolvedValue({ ok: true, json: async () => ({ vehicles }) });
  it("returns the partner's live list, caches it, and lets lookup accept a new id", async () => {
    const f = okJson([{ id: 133, name: "Bike" }, { id: 555, name: "Car", desc: "4 wheeler" }]);
    expect(await svc.getVehicles(f)).toEqual([{ id: 133, name: "Bike", desc: undefined }, { id: 555, name: "Car", desc: "4 wheeler" }]);
    await svc.getVehicles(f);
    expect(f).toHaveBeenCalledTimes(1);
    const stream = fetchOf(sse([{ ...FOUND, data: { ...FOUND.data, fareDetails: { vehicleId: 555 } } }]));
    expect((await svc.lookup({ orderId: 5, vehicleId: 555, fetchImpl: stream })).driver).toBeTruthy();
    await expect(svc.lookup({ orderId: 5, vehicleId: 1, fetchImpl: jest.fn() })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("falls back to the six known vehicles when the API is down", async () => {
    const list = await svc.getVehicles(jest.fn().mockRejectedValue(new Error("down")));
    expect(list.map((v) => v.id)).toEqual([97, 133, 1139, 126, 91, 1]);
  });
});
