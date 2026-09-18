const { normalizeToLast10Digits } = require("../phone");

describe("normalizeToLast10Digits", () => {
  it("returns a bare 10-digit number unchanged", () => {
    expect(normalizeToLast10Digits("9998887771")).toBe("9998887771");
  });

  it("strips a country-code prefix down to the last 10 digits", () => {
    expect(normalizeToLast10Digits("919998887771")).toBe("9998887771");
    expect(normalizeToLast10Digits("+91-999-888-7771")).toBe("9998887771");
  });

  it("handles falsy/empty input without throwing", () => {
    expect(normalizeToLast10Digits("")).toBe("");
    expect(normalizeToLast10Digits(undefined)).toBe("");
    expect(normalizeToLast10Digits(null)).toBe("");
  });
});
