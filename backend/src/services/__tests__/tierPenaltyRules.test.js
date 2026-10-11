const rules = require("../tierPenaltyRules");

describe("tierPenaltyRules", () => {
  it("uses the default ladder when the setting is missing or invalid", () => {
    expect(rules.parseLadder(undefined)).toEqual([5, 10, 20, 50, 100]);
    expect(rules.parseLadder("abc,,")).toEqual([5, 10, 20, 50, 100]);
    expect(rules.parseLadder("0,-5,101")).toEqual([5, 10, 20, 50, 100]);
  });

  it("parses a comma list and drops invalid entries", () => {
    expect(rules.parseLadder("5, 10 ,x,25")).toEqual([5, 10, 25]);
  });

  it("maps the nth miss to the ladder and keeps the last value from the 5th miss on", () => {
    const ladder = rules.DEFAULT_LADDER;
    expect([1, 2, 3, 4, 5, 6, 40].map((n) => rules.pctForMiss(ladder, n))).toEqual([5, 10, 20, 50, 100, 100, 100]);
  });

  it("treats a missing or zero miss number as the first miss", () => {
    expect(rules.pctForMiss(rules.DEFAULT_LADDER, 0)).toBe(5);
    expect(rules.pctForMiss(rules.DEFAULT_LADDER, undefined)).toBe(5);
  });

  it("computes the penalty as a rounded percentage of the order total", () => {
    expect(rules.penaltyAmount(500, 5)).toBe(25);
    expect(rules.penaltyAmount(333, 10)).toBe(33.3);
    expect(rules.penaltyAmount(100.555, 100)).toBe(100.56);
  });

  it("is zero for a missing, zero or negative base or pct", () => {
    expect(rules.penaltyAmount(null, 10)).toBe(0);
    expect(rules.penaltyAmount(0, 10)).toBe(0);
    expect(rules.penaltyAmount(100, 0)).toBe(0);
    expect(rules.penaltyAmount(-5, 10)).toBe(0);
  });

  it("walks free -> daily -> normal and stops", () => {
    expect(rules.nextStage("free")).toBe("daily");
    expect(rules.nextStage("daily")).toBe("normal");
    expect(rules.nextStage("normal")).toBeNull();
    expect(rules.nextStage("bogus")).toBeNull();
  });

  it("only free and daily carry penalties", () => {
    expect(rules.isPenaltyTier("free")).toBe(true);
    expect(rules.isPenaltyTier("daily")).toBe(true);
    expect(rules.isPenaltyTier("normal")).toBe(false);
    expect(rules.isPenaltyTier(null)).toBe(false);
  });
});
