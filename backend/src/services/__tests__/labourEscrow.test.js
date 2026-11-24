const { releasePlan, refundPlan, payableTotal } = require("../labourEscrow");

// Pure escrow state machine. Encodes the money-safety invariants (Review Focus):
//  - release only from 'held', and NEVER while a dispute is open (freeze)
//  - refund-on-cancel only from 'held'
//  - both idempotent (a second call is a no-op)

describe("releasePlan", () => {
  test("held + no dispute -> release", () => {
    expect(releasePlan("held", false)).toEqual({ act: true, nextStatus: "released" });
  });

  test("held + open dispute -> frozen (no release)", () => {
    expect(releasePlan("held", true)).toEqual({ act: false, nextStatus: "held" });
  });

  test("already released -> no-op (idempotent)", () => {
    expect(releasePlan("released", false)).toEqual({ act: false, nextStatus: "released" });
  });

  test("refunded -> no-op", () => {
    expect(releasePlan("refunded", false)).toEqual({ act: false, nextStatus: "refunded" });
  });

  test("none (no labour) -> no-op", () => {
    expect(releasePlan("none", false)).toEqual({ act: false, nextStatus: "none" });
  });
});

describe("refundPlan", () => {
  test("held -> refund", () => {
    expect(refundPlan("held")).toEqual({ act: true, nextStatus: "refunded" });
  });

  test("released -> no refund (driver already paid)", () => {
    expect(refundPlan("released")).toEqual({ act: false, nextStatus: "released" });
  });

  test("already refunded -> no-op (idempotent)", () => {
    expect(refundPlan("refunded")).toEqual({ act: false, nextStatus: "refunded" });
  });

  test("disputed -> no auto-refund (executive decides)", () => {
    expect(refundPlan("disputed")).toEqual({ act: false, nextStatus: "disputed" });
  });
});

describe("payableTotal", () => {
  test("base only when extra not approved", () => {
    expect(payableTotal({ base: 150, extra: 80, extraApproved: false })).toBe(150);
  });

  test("base + extra when approved", () => {
    expect(payableTotal({ base: 150, extra: 80, extraApproved: true })).toBe(230);
  });

  test("handles string/decimal amounts", () => {
    expect(payableTotal({ base: "150.00", extra: "80.00", extraApproved: true })).toBe(230);
  });
});
