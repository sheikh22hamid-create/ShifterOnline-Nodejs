const { computeMarkup, receiverPayable, parseCommissionPercent, round2 } = require("../receiverPayCalc");

describe("receiverPayCalc", () => {
  it("computes markup on the amount the receiver pays", () => {
    expect(computeMarkup(90, 3)).toBe(2.7);
    expect(computeMarkup(99, 3)).toBe(2.97);
  });
  it("rounds to paise", () => expect(computeMarkup(33.33, 3)).toBe(1));
  it("0% or a missing percent gives 0", () => {
    expect(computeMarkup(90, 0)).toBe(0);
    expect(computeMarkup(90, undefined)).toBe(0);
  });
  it("applies the rupee cap when the cap is positive", () => {
    expect(computeMarkup(1000, 5, 20)).toBe(20);
    expect(computeMarkup(100, 5, 20)).toBe(5);
    expect(computeMarkup(1000, 5, 0)).toBe(50);
  });
  it("receiverPayable adds the markup", () => expect(receiverPayable(90, 2.7)).toBe(92.7));
  it("round2 handles float residue", () => expect(round2(0.1 + 0.2)).toBe(0.3));

  describe("parseCommissionPercent", () => {
    it("treats empty as 0", () => {
      expect(parseCommissionPercent(undefined, 5)).toEqual({ ok: true, value: 0 });
      expect(parseCommissionPercent("", 5)).toEqual({ ok: true, value: 0 });
    });
    it("accepts 0..max", () => {
      expect(parseCommissionPercent("3", 5)).toEqual({ ok: true, value: 3 });
      expect(parseCommissionPercent(5, 5)).toEqual({ ok: true, value: 5 });
    });
    it("rejects above max, negative and non-numeric", () => {
      expect(parseCommissionPercent(5.01, 5).ok).toBe(false);
      expect(parseCommissionPercent(-1, 5).ok).toBe(false);
      expect(parseCommissionPercent("abc", 5).ok).toBe(false);
    });
  });
});
