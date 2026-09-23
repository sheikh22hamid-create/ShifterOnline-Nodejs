const {
  normalizeInfoSections,
  parseInfoSections,
  InvalidSectionsError,
  MAX_SECTIONS,
} = require("../driverTierInfo");

describe("driverTierInfo.normalizeInfoSections", () => {
  it("returns null for null, undefined and empty string", () => {
    expect(normalizeInfoSections(null)).toBeNull();
    expect(normalizeInfoSections(undefined)).toBeNull();
    expect(normalizeInfoSections("")).toBeNull();
    expect(normalizeInfoSections("   ")).toBeNull();
  });

  it("accepts an array and returns a JSON string", () => {
    const out = normalizeInfoSections([{ heading: "Earnings", body: "Up to 20/km" }]);
    expect(JSON.parse(out)).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
  });

  it("accepts an already-serialized JSON string", () => {
    const out = normalizeInfoSections('[{"heading":"Earnings","body":"Up to 20/km"}]');
    expect(JSON.parse(out)).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
  });

  it("trims heading and body", () => {
    const out = normalizeInfoSections([{ heading: "  Earnings  ", body: "  Up to 20/km  " }]);
    expect(JSON.parse(out)).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
  });

  it("drops entries where heading and body are both empty, but keeps half-filled ones", () => {
    const out = normalizeInfoSections([
      { heading: "", body: "" },
      { heading: "Only heading", body: "" },
      { heading: "", body: "Only body" },
    ]);
    expect(JSON.parse(out)).toEqual([
      { heading: "Only heading", body: "" },
      { heading: "", body: "Only body" },
    ]);
  });

  it("returns null when every entry is empty", () => {
    expect(normalizeInfoSections([{ heading: "", body: "" }])).toBeNull();
    expect(normalizeInfoSections([])).toBeNull();
  });

  it("treats missing heading or body keys as empty strings", () => {
    const out = normalizeInfoSections([{ heading: "Only heading" }, { body: "Only body" }]);
    expect(JSON.parse(out)).toEqual([
      { heading: "Only heading", body: "" },
      { heading: "", body: "Only body" },
    ]);
  });

  it("rejects JSON that is not an array", () => {
    expect(() => normalizeInfoSections('{"a":1}')).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections('"hello"')).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections("42")).toThrow(InvalidSectionsError);
  });

  it("rejects a string that is not valid JSON", () => {
    expect(() => normalizeInfoSections("not json at all")).toThrow(InvalidSectionsError);
  });

  it("rejects elements that are not plain objects", () => {
    expect(() => normalizeInfoSections(["a string"])).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections([null])).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections([["nested"]])).toThrow(InvalidSectionsError);
  });

  it("rejects non-string heading or body", () => {
    expect(() => normalizeInfoSections([{ heading: 5, body: "ok" }])).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections([{ heading: "ok", body: { a: 1 } }])).toThrow(InvalidSectionsError);
  });

  it("rejects more than MAX_SECTIONS sections", () => {
    const tooMany = Array.from({ length: MAX_SECTIONS + 1 }, (_, i) => ({ heading: `H${i}`, body: "b" }));
    expect(() => normalizeInfoSections(tooMany)).toThrow(/12/);
  });

  it("rejects an over-long heading or body", () => {
    expect(() => normalizeInfoSections([{ heading: "x".repeat(121), body: "b" }])).toThrow(/120/);
    expect(() => normalizeInfoSections([{ heading: "h", body: "x".repeat(2001) }])).toThrow(/2000/);
  });

  it("keeps newlines inside a body", () => {
    const out = normalizeInfoSections([{ heading: "Suitable for", body: "line one\nline two" }]);
    expect(JSON.parse(out)[0].body).toBe("line one\nline two");
  });
});

describe("driverTierInfo.parseInfoSections", () => {
  it("returns an empty array for null and empty string", () => {
    expect(parseInfoSections(null)).toEqual([]);
    expect(parseInfoSections("")).toEqual([]);
  });

  it("parses a stored JSON string", () => {
    expect(parseInfoSections('[{"heading":"Earnings","body":"Up to 20/km"}]')).toEqual([
      { heading: "Earnings", body: "Up to 20/km" },
    ]);
  });

  it("returns an empty array for malformed JSON instead of throwing", () => {
    expect(parseInfoSections("{not json")).toEqual([]);
  });

  it("returns an empty array for valid JSON that is not an array", () => {
    expect(parseInfoSections('{"heading":"x"}')).toEqual([]);
  });

  it("drops junk entries and coerces missing keys to empty strings", () => {
    expect(parseInfoSections('[null,"str",{"heading":"H"},{"heading":"","body":""}]')).toEqual([
      { heading: "H", body: "" },
    ]);
  });

  it("passes an already-parsed array through", () => {
    expect(parseInfoSections([{ heading: "H", body: "B" }])).toEqual([{ heading: "H", body: "B" }]);
  });
});
