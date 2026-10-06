const rules = require("../freeBookingRules");

const { STATUS, OUTCOME, REASON } = rules;

describe("istDateString", () => {
  it("rolls to the next IST day after 18:30 UTC", () => {
    expect(rules.istDateString(new Date("2026-10-06T18:29:00Z"))).toBe("2026-10-06");
    expect(rules.istDateString(new Date("2026-10-06T18:31:00Z"))).toBe("2026-10-07");
  });
});

describe("isCityOfferOpen", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const base = { enabled: true, offer_start: new Date("2026-10-01T00:00:00Z"), offer_end: new Date("2026-10-31T00:00:00Z") };
  it("is open inside the window", () => expect(rules.isCityOfferOpen(base, now)).toBe(true));
  it("is closed when disabled", () => expect(rules.isCityOfferOpen({ ...base, enabled: false }, now)).toBe(false));
  it("is closed with no setting row", () => expect(rules.isCityOfferOpen(null, now)).toBe(false));
  it("is closed before start and after end", () => {
    expect(rules.isCityOfferOpen({ ...base, offer_start: new Date("2026-10-07T00:00:00Z") }, now)).toBe(false);
    expect(rules.isCityOfferOpen({ ...base, offer_end: new Date("2026-10-05T00:00:00Z") }, now)).toBe(false);
  });
  it("is closed when a date is missing", () => {
    expect(rules.isCityOfferOpen({ ...base, offer_end: null }, now)).toBe(false);
    expect(rules.isCityOfferOpen({ ...base, offer_start: null }, now)).toBe(false);
  });
});

describe("decideOutcome", () => {
  const ok = { premium: true, cityOpen: true, locked: false, openBooking: false, poolVehicleFound: true };
  it("eligible when everything holds", () => expect(rules.decideOutcome(ok)).toBe(OUTCOME.ELIGIBLE));
  it("not_premium wins over everything", () => expect(rules.decideOutcome({ ...ok, premium: false, cityOpen: false })).toBe(OUTCOME.NOT_PREMIUM));
  it("offer_off before locked", () => expect(rules.decideOutcome({ ...ok, cityOpen: false, locked: true })).toBe(OUTCOME.OFFER_OFF));
  it("locked before open_booking", () => expect(rules.decideOutcome({ ...ok, locked: true, openBooking: true })).toBe(OUTCOME.LOCKED));
  it("open_booking before pool", () => expect(rules.decideOutcome({ ...ok, openBooking: true, poolVehicleFound: false })).toBe(OUTCOME.OPEN_BOOKING));
  it("no_free_vehicle when the pool has nobody in range", () => expect(rules.decideOutcome({ ...ok, poolVehicleFound: false })).toBe(OUTCOME.NO_FREE_VEHICLE));
});

describe("isPaymentSettled", () => {
  it("no settlement row means nothing to collect", () => expect(rules.isPaymentSettled(null)).toBe(true));
  it("cash_received and paid_online are settled", () => {
    expect(rules.isPaymentSettled({ status: "cash_received" })).toBe(true);
    expect(rules.isPaymentSettled({ status: "paid_online" })).toBe(true);
  });
  it("pending, disputed, waived, customer_owes are not settled", () => {
    for (const status of ["pending", "disputed", "waived", "customer_owes"]) {
      expect(rules.isPaymentSettled({ status })).toBe(false);
    }
  });
});

describe("decideCredit", () => {
  const row = { status: STATUS.REWARD_PENDING, accepted_in_pool: true, pool_rider_id: 9, actual_fare: "500.00" };
  const order = { o_status: "Completed", rid: 9 };
  const go = (o = {}) => rules.decideCredit({ row, order, userLocked: false, paymentSettled: true, ...o });

  it("credits the full actual fare", () => expect(go()).toEqual({ action: "credit", amount: 500 }));
  it("skips a missing or already-final row", () => {
    expect(go({ row: null }).action).toBe("skip");
    expect(go({ row: { ...row, status: STATUS.REWARD_CREDITED } }).action).toBe("skip");
    expect(go({ row: { ...row, status: STATUS.NOT_ELIGIBLE } }).action).toBe("skip");
  });
  it("voids a cancelled order", () => expect(go({ order: { ...order, o_status: "Cancelled" } })).toEqual({ action: "void", reason: REASON.CANCELLED }));
  it("waits while the order is not completed or the fare is not recorded", () => {
    expect(go({ order: { ...order, o_status: "Processing" } }).action).toBe("wait");
    expect(go({ row: { ...row, actual_fare: null } }).action).toBe("wait");
  });
  it("voids when a different driver finished the trip", () => expect(go({ order: { ...order, rid: 10 } })).toEqual({ action: "void", reason: REASON.VEHICLE_CHANGED }));
  it("voids when the accepting driver was not in the pool", () => expect(go({ row: { ...row, accepted_in_pool: false } }).reason).toBe(REASON.VEHICLE_CHANGED));
  it("waits while payment is not settled", () => expect(go({ paymentSettled: false }).action).toBe("wait"));
  it("voids a waived settlement as payment_failed (the customer never pays)", () => {
    expect(go({ paymentSettled: false, settlementStatus: "waived" })).toEqual({ action: "void", reason: REASON.PAYMENT_FAILED });
  });
  it.each(["pending", "disputed", "customer_owes"])("keeps waiting while the settlement is %s", (settlementStatus) => {
    expect(go({ paymentSettled: false, settlementStatus }).action).toBe("wait");
  });
  it("voids when the user is locked", () => expect(go({ userLocked: true })).toEqual({ action: "void", reason: REASON.LOCKED }));
  it("voids a zero fare", () => expect(go({ row: { ...row, actual_fare: "0" } })).toEqual({ action: "void", reason: REASON.ZERO_FARE }));
});
