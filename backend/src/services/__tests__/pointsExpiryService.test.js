// In-memory stand-in for the three tables the expiry service touches.
const db = { log: [], users: {}, settings: { points_expiry: null }, nextId: 1 };
const mockPrisma = {
  tbl_referral_setting: { findFirst: jest.fn(async () => db.settings) },
  tbl_referral_point_log: {
    findUnique: jest.fn(async ({ where }) => db.log.find((r) => r.id === where.id) || null),
    findMany: jest.fn(async ({ where = {}, take }) => {
      let rows = db.log.filter((r) => (where.user_id === undefined || r.user_id === where.user_id)
        && (where.user_type === undefined || r.user_type === where.user_type)
        && (where.expiry_status === undefined || r.expiry_status === where.expiry_status)
        && (!where.expires_at || (r.expires_at && r.expires_at <= where.expires_at.lte)));
      rows = rows.sort((a, b) => a.id - b.id);
      return take ? rows.slice(0, take) : rows;
    }),
    create: jest.fn(async ({ data }) => {
      if (data.origin_log_id && db.log.some((r) => r.origin_log_id === data.origin_log_id)) throw new Error("Unique constraint failed: uniq_expiry_origin");
      const row = { id: db.nextId++, expired_points: 0, expires_at: null, expiry_status: null, origin_log_id: null, activity: null, ...data };
      db.log.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => {
      const row = db.log.find((r) => r.id === where.id);
      for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? row[k] + v.increment : v;
      return row;
    }),
  },
  tbl_user: {
    findUnique: jest.fn(async ({ where }) => db.users[where.id] || null),
    update: jest.fn(async ({ where, data }) => {
      const u = db.users[where.id];
      u.referral_points += data.referral_points.decrement ? -data.referral_points.decrement : 0;
      return u;
    }),
  },
  tbl_rider: {},
  $queryRawUnsafe: jest.fn(async () => []),
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
jest.mock("../../config/db", () => mockPrisma);
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const svc = require("../pointsExpiryService");

const T0 = new Date("2027-01-10T08:00:00Z");
const AFTER = new Date("2027-04-10T09:00:00Z");

function creditRow(points, balanceAfter) {
  return mockPrisma.tbl_referral_point_log.create({ data: { user_id: 1, user_type: "USER", points, txn_type: "credit", source: "referral_reward", balance_after: balanceAfter, created_at: T0, activity: "successful_referral", expires_at: new Date("2027-04-10T08:00:00Z"), expiry_status: "active", expiry_duration: "3 months" } });
}
const debitRow = (points, balanceAfter, at) => mockPrisma.tbl_referral_point_log.create({ data: { user_id: 1, user_type: "USER", points: -points, txn_type: "debit", source: "ride_discount", balance_after: balanceAfter, created_at: at } });

beforeEach(() => {
  db.log = []; db.nextId = 1; db.users = { 1: { id: 1, referral_points: 0 } }; db.settings = { points_expiry: null };
});

describe("stampCredit", () => {
  test("no duration configured: the activity is recorded, no expiry is invented", async () => {
    const s = await svc.stampCredit({ activity: "successful_referral", userType: "USER", points: 100, now: T0 });
    expect(s.fields).toEqual({ activity: "successful_referral" });
    expect(s.suffix).toBe("");
  });
  test("configured 3 months: expiry fixed at credit time", async () => {
    db.settings.points_expiry = { successful_referral: { USER: { value: 3, unit: "months" } } };
    const s = await svc.stampCredit({ activity: "successful_referral", userType: "USER", points: 100, now: T0 });
    expect(s.fields.expires_at.toISOString()).toBe("2027-04-10T08:00:00.000Z");
    expect(s.fields.expiry_status).toBe("active");
    expect(s.description).toBe("Successful Referral: +100 points | Expires on: 10 Apr 2027");
  });
  test("a different user type is not affected by the setting", async () => {
    db.settings.points_expiry = { successful_referral: { DRIVER: { value: 3, unit: "months" } } };
    expect((await svc.stampCredit({ activity: "successful_referral", userType: "USER", points: 5, now: T0 })).fields.expires_at).toBeUndefined();
  });
  test("a settings read error still credits, without expiry", async () => {
    mockPrisma.tbl_referral_setting.findFirst.mockRejectedValueOnce(new Error("db down"));
    const s = await svc.stampCredit({ activity: "number_sharing", userType: "DRIVER", points: 20, now: T0 });
    expect(s.fields).toEqual({ activity: "number_sharing" });
  });
});

describe("processLot", () => {
  test("untouched 100 points: all 100 expire, balance and ledger agree", async () => {
    db.users[1].referral_points = 100;
    const lot = await creditRow(100, 100);
    expect(await svc.processLot(lot.id, AFTER)).toEqual({ status: "expired", points: 100 });
    expect(db.users[1].referral_points).toBe(0);
    const exp = db.log.find((r) => r.txn_type === "expiry");
    expect(exp).toMatchObject({ points: -100, source: "points_expiry", origin_log_id: lot.id, note: "Points Expired – Successful Referral", balance_after: 0, expiry_status: "processed" });
    expect(db.log.find((r) => r.id === lot.id)).toMatchObject({ expiry_status: "settled", expired_points: 100 });
  });

  test("40 of 100 redeemed before expiry: only the remaining 60 expire", async () => {
    db.users[1].referral_points = 100;
    const lot = await creditRow(100, 100);
    db.users[1].referral_points = 60;
    await debitRow(40, 60, new Date("2027-02-01T00:00:00Z"));
    expect(await svc.processLot(lot.id, AFTER)).toEqual({ status: "expired", points: 60 });
    expect(db.log.filter((r) => r.txn_type === "expiry").map((r) => r.points)).toEqual([-60]);
    expect(db.users[1].referral_points).toBe(0);
  });

  test("other valid points of the user are untouched", async () => {
    db.users[1].referral_points = 150;
    const lot = await creditRow(100, 100);
    await mockPrisma.tbl_referral_point_log.create({ data: { user_id: 1, user_type: "USER", points: 50, txn_type: "credit", source: "referral_reward", balance_after: 150, created_at: new Date("2027-03-01T00:00:00Z"), activity: "successful_referral", expires_at: new Date("2027-06-01T00:00:00Z"), expiry_status: "active" } });
    await svc.processLot(lot.id, AFTER);
    expect(db.users[1].referral_points).toBe(50);
  });

  test("running it twice never deducts twice", async () => {
    db.users[1].referral_points = 100;
    const lot = await creditRow(100, 100);
    await svc.processLot(lot.id, AFTER);
    expect(await svc.processLot(lot.id, AFTER)).toEqual({ status: "skipped", points: 0 });
    expect(db.log.filter((r) => r.txn_type === "expiry")).toHaveLength(1);
    expect(db.users[1].referral_points).toBe(0);
  });

  test("not yet due: nothing happens", async () => {
    db.users[1].referral_points = 100;
    const lot = await creditRow(100, 100);
    expect((await svc.processLot(lot.id, new Date("2027-03-01T00:00:00Z"))).status).toBe("skipped");
    expect(db.users[1].referral_points).toBe(100);
  });

  test("fully redeemed before expiry: settled with nothing to expire, no zero-point ledger row", async () => {
    db.users[1].referral_points = 100;
    const lot = await creditRow(100, 100);
    db.users[1].referral_points = 0;
    await debitRow(100, 0, new Date("2027-02-01T00:00:00Z"));
    expect((await svc.processLot(lot.id, AFTER)).status).toBe("nothing_left");
    expect(db.log.some((r) => r.txn_type === "expiry")).toBe(false);
    expect(db.log.find((r) => r.id === lot.id).expiry_status).toBe("settled");
  });

  test("the balance can never go negative when points were spent outside the ledger", async () => {
    db.users[1].referral_points = 30; // ledger says 100 remain, the counter says 30
    const lot = await creditRow(100, 100);
    expect(await svc.processLot(lot.id, AFTER)).toEqual({ status: "expired", points: 30 });
    expect(db.users[1].referral_points).toBe(0);
  });

  test("a failure inside the transaction leaves the credit active for a retry", async () => {
    db.users[1].referral_points = 100;
    const lot = await creditRow(100, 100);
    mockPrisma.$transaction.mockImplementationOnce(async () => { throw new Error("deadlock"); });
    await expect(svc.processLot(lot.id, AFTER)).rejects.toThrow("deadlock");
    expect(db.log.find((r) => r.id === lot.id).expiry_status).toBe("active");
    expect((await svc.processLot(lot.id, AFTER)).points).toBe(100);
  });
});

describe("sweepDue / settleUser", () => {
  test("sweep expires every due credit separately, with their own rows", async () => {
    db.users[1].referral_points = 30;
    await creditRow(10, 10);
    await creditRow(20, 30);
    const r = await svc.sweepDue({ now: AFTER });
    expect(r).toEqual({ processed: 2, expired: 30, failed: 0 });
    expect(db.log.filter((x) => x.txn_type === "expiry")).toHaveLength(2);
  });
  test("a failing credit is counted and the rest still run", async () => {
    db.users[1].referral_points = 30;
    await creditRow(10, 10);
    await creditRow(20, 30);
    mockPrisma.$transaction.mockImplementationOnce(async () => { throw new Error("boom"); });
    const r = await svc.sweepDue({ now: AFTER });
    expect(r).toMatchObject({ processed: 2, failed: 1 });
    expect(db.log.filter((x) => x.txn_type === "expiry")).toHaveLength(1);
  });
  test("settleUser expires just that user's due points and never throws", async () => {
    db.users[1].referral_points = 100;
    await creditRow(100, 100);
    jest.useFakeTimers().setSystemTime(AFTER);
    expect(await svc.settleUser("USER", 1)).toBe(1);
    jest.useRealTimers();
    expect(db.users[1].referral_points).toBe(0);
    mockPrisma.tbl_referral_point_log.findMany.mockRejectedValueOnce(new Error("x"));
    expect(await svc.settleUser("USER", 1)).toBe(0);
  });
});
