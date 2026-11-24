const { resolveAmounts, canRaise } = require("../labourDispute");

describe("resolveAmounts (executive outcome, money conserved)", () => {
  test("release -> all to driver", () => {
    expect(resolveAmounts("release", 230, null)).toEqual({ driver: 230, refund: 0 });
  });

  test("refund -> all to customer", () => {
    expect(resolveAmounts("refund", 230, null)).toEqual({ driver: 0, refund: 230 });
  });

  test("split -> driver gets the entered amount, customer the rest", () => {
    expect(resolveAmounts("split", 230, 100)).toEqual({ driver: 100, refund: 130 });
  });

  test("split conserves money with decimals (no rounding leak)", () => {
    const r = resolveAmounts("split", 100.01, 33.34);
    expect(r.driver + r.refund).toBe(100.01);
    expect(r).toEqual({ driver: 33.34, refund: 66.67 });
  });

  test("split clamps a driver amount above the held total", () => {
    expect(resolveAmounts("split", 230, 999)).toEqual({ driver: 230, refund: 0 });
  });

  test("split clamps a negative driver amount to zero", () => {
    expect(resolveAmounts("split", 230, -50)).toEqual({ driver: 0, refund: 230 });
  });

  test("unknown action throws", () => {
    expect(() => resolveAmounts("bogus", 230, 0)).toThrow();
  });
});

describe("canRaise", () => {
  test("held + no open dispute -> can raise", () => {
    expect(canRaise("held", false)).toBe(true);
  });
  test("already disputed / open dispute -> cannot raise again", () => {
    expect(canRaise("disputed", true)).toBe(false);
    expect(canRaise("held", true)).toBe(false);
  });
  test("released / refunded / none -> cannot raise (Phase 1)", () => {
    expect(canRaise("released", false)).toBe(false);
    expect(canRaise("refunded", false)).toBe(false);
    expect(canRaise("none", false)).toBe(false);
  });
});
