const { computeGuaranteeCompensation, guaranteeStateFor } = require("../bookingGuaranteeRules");

// Ids are deliberately NOT in sort order (Model 1 has the highest id) to prove the rule uses sort_order.
const PKGS = [
  { id: 30, sort_order: 1, no_driver_compensation: "0.00" },
  { id: 20, sort_order: 2, no_driver_compensation: "100.00" },
  { id: 10, sort_order: 3, no_driver_compensation: "500.00" },
  { id: 40, sort_order: 4, no_driver_compensation: "1000.00" },
  { id: 50, sort_order: 5, no_driver_compensation: "2000.00" },
];
const pick = (...orders) => PKGS.filter((p) => orders.includes(p.sort_order));

describe("computeGuaranteeCompensation - the five spec examples", () => {
  it("Model 1 only -> 0", () => expect(computeGuaranteeCompensation(pick(1)).amount).toBe(0));
  it("Models 1,2 -> 100 (Model 2 ON beats Model 1)", () => expect(computeGuaranteeCompensation(pick(1, 2)).amount).toBe(100));
  it("Models 1,2,3 -> 500", () => expect(computeGuaranteeCompensation(pick(1, 2, 3)).amount).toBe(500));
  it("Models 1-4 -> 1000", () => expect(computeGuaranteeCompensation(pick(1, 2, 3, 4)).amount).toBe(1000));
  it("Models 1-5 -> 2000", () => expect(computeGuaranteeCompensation(pick(1, 2, 3, 4, 5)).amount).toBe(2000));
});

describe("computeGuaranteeCompensation - generality", () => {
  it("a Model 6 added later works with no code change", () => {
    const withSix = [...PKGS, { id: 60, sort_order: 6, no_driver_compensation: 5000 }];
    expect(computeGuaranteeCompensation(withSix)).toEqual({ packageId: 60, amount: 5000 });
  });
  it("the highest sort_order wins even when it is not the highest id", () => {
    expect(computeGuaranteeCompensation(pick(1, 3)).packageId).toBe(10); // sort_order 3 has id 10
  });
  it("a non-contiguous toggle (1 and 5 ON, 2-4 OFF) pays Model 5's amount", () => {
    expect(computeGuaranteeCompensation(pick(1, 5)).amount).toBe(2000);
  });
  it("equal sort_order is broken by the higher id", () => {
    const tied = [{ id: 1, sort_order: 2, no_driver_compensation: 10 }, { id: 9, sort_order: 2, no_driver_compensation: 20 }];
    expect(computeGuaranteeCompensation(tied)).toEqual({ packageId: 9, amount: 20 });
  });
  it("empty / invalid input pays nothing", () => {
    expect(computeGuaranteeCompensation([])).toEqual({ packageId: null, amount: 0 });
    expect(computeGuaranteeCompensation(null)).toEqual({ packageId: null, amount: 0 });
  });
  it("a negative or non-numeric configured amount is treated as 0", () => {
    expect(computeGuaranteeCompensation([{ id: 1, sort_order: 1, no_driver_compensation: -50 }]).amount).toBe(0);
    expect(computeGuaranteeCompensation([{ id: 1, sort_order: 1, no_driver_compensation: "abc" }]).amount).toBe(0);
  });
  it("rounds to 2 decimals", () => {
    expect(computeGuaranteeCompensation([{ id: 1, sort_order: 1, no_driver_compensation: "10.456" }]).amount).toBe(10.46);
  });
});

describe("guaranteeStateFor", () => {
  it("no case -> none", () => expect(guaranteeStateFor(null)).toBe("none"));
  it("open -> pending", () => expect(guaranteeStateFor({ status: "open", compensation_amount: "100" })).toBe("pending"));
  it("expired with money -> paid", () => expect(guaranteeStateFor({ status: "expired_compensated", compensation_amount: "100" })).toBe("paid"));
  it("expired with 0 -> not_paid", () => expect(guaranteeStateFor({ status: "expired_compensated", compensation_amount: "0" })).toBe("not_paid"));
  it("admin assigned / cancelled -> none", () => {
    expect(guaranteeStateFor({ status: "resolved_assigned", compensation_amount: "100" })).toBe("none");
    expect(guaranteeStateFor({ status: "cancelled", compensation_amount: "100" })).toBe("none");
  });
});
