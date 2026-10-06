// backend/src/services/__tests__/trackSnapshotDelivered.test.js
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn() },
  order_receiver_pay: { findUnique: jest.fn() },
  order_settlement: { findUnique: jest.fn() },
  order_receiver_feedback: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../receiverTrackSettings", () => ({
  isTrackingEnabled: jest.fn(),
  getHelpConfig: jest.fn(() => ({ phone: "9109114515", whatsapp: "919109114515" })),
  APP_URL: "https://play.example/app",
}));
jest.mock("../trackEtaService", () => ({ getEta: jest.fn(), getRoute: jest.fn(), clearOrder: jest.fn(), simplify: jest.fn((p) => p) }));
jest.mock("../tripRouteService", () => ({ buildRoute: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../receiverTrackSettings");
const tripRoute = require("../tripRouteService");
const { buildSnapshot, isCompleted, deliveredWindowOpen, loadLinkedOrder } = require("../trackSnapshotService");

const NOW = Date.UTC(2026, 9, 7, 8, 0, 0); // 22.5 h after the 15:00 IST delivery below
const link = { id: 1, order_id: 50, receiver_phone: "9876543210" };
const order = (o = {}) => ({
  id: 50, rid: 9, order_status: 5, o_status: "Completed", dmobile: "98765 43210",
  plat: "22.70", plong: "75.80", dlat: "22.80", dlong: "75.90",
  paddress: "Pickup road", daddress: "Drop road", drop_time: new Date("2026-10-06T15:00:00Z"), ddate: null, ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  settings.isTrackingEnabled.mockResolvedValue(true);
  prisma.pkg_order.findUnique.mockResolvedValue(order());
  prisma.tbl_rider.findUnique.mockResolvedValue({ first_name: "Suresh Kumar", vehicle_no: "MP09AB1234" });
  prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
  prisma.order_settlement.findUnique.mockResolvedValue(null);
  prisma.order_receiver_feedback.findUnique.mockResolvedValue(null);
  tripRoute.buildRoute.mockResolvedValue({
    has_trail: true, distance_km: 4.26,
    points: [{ lat: 22.7, lng: 75.8 }, { lat: 22.75, lng: 75.85 }, { lat: 22.8, lng: 75.9 }],
    pickup: { lat: 22.7, lng: 75.8 }, final_pickup: null, drop: { lat: 22.8, lng: 75.9 },
  });
});

const run = () => buildSnapshot(link, { now: NOW });

describe("delivered summary and trip route", () => {
  it("returns the summary, the trip route as [lat,lng] pairs and the static blocks", async () => {
    const s = await run();
    expect(s).toMatchObject({
      state: "delivered", order_id: 50, step: 5, delivered_at: "2026-10-06T15:00:00.000+05:30", poll_ms: 15000,
      summary: { driver: { first_name: "Suresh", vehicle_no: "MP09AB1234" }, pickup: { address: "Pickup road" }, drop: { address: "Drop road" }, distance_km: 4.3 },
      trip_route: { has_trail: true, points: [[22.7, 75.8], [22.75, 75.85], [22.8, 75.9]], pickup: { lat: 22.7, lng: 75.8 }, drop: { lat: 22.8, lng: 75.9 } },
      review: { submitted: false },
      help: { phone: "9109114515", whatsapp: "919109114515" },
      app_url: "https://play.example/app",
    });
  });
  it("uses the changed pickup (final_pickup) when the pickup was moved", async () => {
    tripRoute.buildRoute.mockResolvedValue({ has_trail: false, distance_km: 0, points: [], pickup: { lat: 1, lng: 2 }, final_pickup: { lat: 3, lng: 4 }, drop: { lat: 5, lng: 6 } });
    const s = await run();
    expect(s.trip_route).toEqual({ has_trail: false, points: [], pickup: { lat: 3, lng: 4 }, drop: { lat: 5, lng: 6 } });
    expect(s.summary.distance_km).toBeNull();
  });
  it("a failing route builder only blanks the route; the rest of the screen is intact", async () => {
    tripRoute.buildRoute.mockRejectedValue(new Error("db"));
    const s = await run();
    expect(s.trip_route).toBeNull();
    expect(s.summary.driver).toEqual({ first_name: "Suresh", vehicle_no: "MP09AB1234" });
    expect(s.help.phone).toBe("9109114515");
  });
  it("a missing driver gives driver null", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    expect((await run()).summary.driver).toBeNull();
  });
  it("is still delivered when the review table cannot be read", async () => {
    prisma.order_receiver_feedback.findUnique.mockRejectedValue(new Error("no table"));
    expect((await run()).review).toEqual({ submitted: false });
  });
  it("review.submitted is true when a review exists", async () => {
    prisma.order_receiver_feedback.findUnique.mockResolvedValue({ id: 1 });
    expect((await run()).review).toEqual({ submitted: true });
  });
});

describe("pay block (money only for Receiver-pays orders)", () => {
  const settlement = (o = {}) => ({ payer: "receiver", status: "pending", amount_due: 100, receiver_markup: 3, ...o });
  it("an order without a Receiver-pays row has no pay block and no money field anywhere", async () => {
    const s = await run();
    expect(s.pay).toBeNull();
    const text = JSON.stringify(s);
    for (const key of ["amount_due", "markup", "total\"", "fare", "wallet", "otp"]) expect(text).not.toContain(key);
  });
  it("payable while the settlement is receiver / pending", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({ status: "active" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement());
    expect((await run()).pay).toEqual({ state: "payable", amount_due: 100, markup: 3, total: 103 });
  });
  it("paid once the row is paid (cash or online), with the total that was due", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({ status: "paid" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ status: "cash_received" }));
    expect((await run()).pay).toEqual({ state: "paid", amount_due: 100, markup: 3, total: 103 });
  });
  it.each(["declined", "closed"])("no pay block when the row is %s", async (status) => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({ status });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ payer: "customer" }));
    expect((await run()).pay).toBeNull();
  });
  it("no pay block when the settlement is missing, or an active row's settlement is not pending", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({ status: "active" });
    expect((await run()).pay).toBeNull();
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ status: "disputed" }));
    expect((await run()).pay).toBeNull();
  });
});

describe("delivered extras are delivered-only", () => {
  it("an active order carries none of them", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 3, o_status: "On_Route", drop_time: null }));
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
    const s = await run();
    for (const key of ["summary", "trip_route", "pay", "review", "help", "app_url"]) expect(s).not.toHaveProperty(key);
  });
  it("a cancelled or expired order carries none of them", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 4, o_status: "Cancelled" }));
    expect(Object.keys(await run()).sort()).toEqual(["order_id", "poll_ms", "state"]);
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    const late = await buildSnapshot(link, { now: Date.UTC(2026, 9, 7, 10, 0, 0) });
    expect(late).toEqual({ state: "expired", poll_ms: 15000 });
  });
});

describe("exported helpers", () => {
  it("isCompleted / deliveredWindowOpen", () => {
    expect(isCompleted({ order_status: 5, o_status: "x" })).toBe(true);
    expect(isCompleted({ order_status: 3, o_status: "Completed" })).toBe(true);
    expect(isCompleted({ order_status: 3, o_status: "On_Route" })).toBe(false);
    const o = order();
    expect(deliveredWindowOpen(o, NOW)).toBe(true);
    expect(deliveredWindowOpen(o, Date.UTC(2026, 9, 7, 10, 0, 0))).toBe(false);
    expect(deliveredWindowOpen(order({ drop_time: null }), NOW)).toBe(true);
  });
  it("loadLinkedOrder gives a reason when the flag is off or the number changed", async () => {
    settings.isTrackingEnabled.mockResolvedValue(false);
    expect(await loadLinkedOrder(link)).toEqual({ reason: "expired" });
    settings.isTrackingEnabled.mockResolvedValue(true);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ dmobile: "9000000000" }));
    expect(await loadLinkedOrder(link)).toEqual({ reason: "invalid" });
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    expect((await loadLinkedOrder(link)).order.id).toBe(50);
  });
});
