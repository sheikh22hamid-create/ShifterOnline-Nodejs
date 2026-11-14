const {
  MAIN_AREA_PRIORITY,
  isPlusCode,
  sanitizeTitle,
  parseGoogleAddressComponents,
  pickMainAreaFromResults,
  formatAddressForDisplay,
  resolveLocationTitle,
} = require("../addressTitle");

const comp = (long_name, types) => ({ long_name, short_name: long_name, types });

const CITY_STATE_PIN = [
  comp("Indore", ["locality", "political"]),
  comp("Indore Division", ["administrative_area_level_2", "political"]),
  comp("Madhya Pradesh", ["administrative_area_level_1", "political"]),
  comp("India", ["country", "political"]),
  comp("452016", ["postal_code"]),
];

const KHAJRANA_COMPONENTS = [
  comp("12", ["premise"]),
  comp("Ring Road", ["route"]),
  comp("Asharfi Colony", ["political", "sublocality", "sublocality_level_2"]),
  comp("Khajrana", ["political", "sublocality", "sublocality_level_1"]),
  ...CITY_STATE_PIN,
];

const PLUS_CODE_RESULT = {
  formatted_address: "PWD4+0X Indore, Madhya Pradesh, India",
  address_components: [
    comp("PWD4+0X", ["plus_code"]),
    ...CITY_STATE_PIN,
  ],
};

const KHAJRANA_RESULT = {
  formatted_address: "12, Ring Road, Asharfi Colony, Khajrana, Indore, Madhya Pradesh 452016, India",
  address_components: KHAJRANA_COMPONENTS,
};

describe("MAIN_AREA_PRIORITY", () => {
  it("defaults to the four locality types, never city/district/state", () => {
    expect(MAIN_AREA_PRIORITY).toEqual([
      "sublocality_level_1",
      "neighborhood",
      "sublocality_level_2",
      "sublocality",
    ]);
    for (const t of ["locality", "administrative_area_level_1", "administrative_area_level_2", "administrative_area_level_3"]) {
      expect(MAIN_AREA_PRIORITY).not.toContain(t);
    }
  });
});

describe("isPlusCode", () => {
  it("detects short and compound plus codes", () => {
    expect(isPlusCode("pwd40+")).toBe(true);
    expect(isPlusCode("7JMH+4X Indore")).toBe(true);
  });

  it("does not flag locality names", () => {
    expect(isPlusCode("Khajrana")).toBe(false);
    expect(isPlusCode("Malviya Nagar")).toBe(false);
    expect(isPlusCode("")).toBe(false);
    expect(isPlusCode(null)).toBe(false);
  });
});

describe("sanitizeTitle", () => {
  it("trims and caps at 120 chars", () => {
    const out = sanitizeTitle("  " + "a".repeat(300) + "  ");
    expect(out).toHaveLength(120);
    expect(out).toBe("a".repeat(120));
  });

  it("strips control characters and collapses whitespace", () => {
    expect(sanitizeTitle("Khaj\u0000rana\n\t  Square\u007f")).toBe("Khajrana Square");
  });

  it("returns null for whitespace-only or non-string input", () => {
    expect(sanitizeTitle("   \n\t ")).toBeNull();
    expect(sanitizeTitle("")).toBeNull();
    expect(sanitizeTitle(null)).toBeNull();
    expect(sanitizeTitle(undefined)).toBeNull();
    expect(sanitizeTitle(42)).toBeNull();
    expect(sanitizeTitle({ a: 1 })).toBeNull();
  });
});

describe("parseGoogleAddressComponents", () => {
  it("prefers sublocality_level_1 over sublocality_level_2", () => {
    const out = parseGoogleAddressComponents(KHAJRANA_COMPONENTS);
    expect(out.mainArea).toBe("Khajrana");
    expect(out.route).toBe("Ring Road");
    expect(out.premise).toBe("12");
  });

  it("uses neighborhood when sublocality_level_1 is missing", () => {
    const out = parseGoogleAddressComponents([
      comp("Asharfi Colony", ["political", "sublocality", "sublocality_level_2"]),
      comp("Malviya Nagar", ["neighborhood", "political"]),
      ...CITY_STATE_PIN,
    ]);
    expect(out.mainArea).toBe("Malviya Nagar");
  });

  // Real Google data tags every sublocality_level_N component with the generic
  // "sublocality" type too, finest level usually listed first.
  it("picks the broader level_2 over a finer level_3 colony listed first (no level_1, no neighborhood)", () => {
    const out = parseGoogleAddressComponents([
      comp("Asharfi Colony", ["sublocality_level_3", "sublocality", "political"]),
      comp("Khajrana", ["sublocality_level_2", "sublocality", "political"]),
      ...CITY_STATE_PIN,
    ]);
    expect(out.mainArea).toBe("Khajrana");
  });

  it("level_1 wins over neighborhood, level_2 and level_3 regardless of listing order", () => {
    const out = parseGoogleAddressComponents([
      comp("Asharfi Colony", ["sublocality_level_3", "sublocality", "political"]),
      comp("Malviya Nagar", ["neighborhood", "political"]),
      comp("Khajrana Road", ["sublocality_level_2", "sublocality", "political"]),
      comp("Khajrana", ["sublocality_level_1", "sublocality", "political"]),
      ...CITY_STATE_PIN,
    ]);
    expect(out.mainArea).toBe("Khajrana");
  });

  it("neighborhood beats level_2 when level_1 is missing", () => {
    const out = parseGoogleAddressComponents([
      comp("Khajrana Road", ["sublocality_level_2", "sublocality", "political"]),
      comp("Malviya Nagar", ["neighborhood", "political"]),
      ...CITY_STATE_PIN,
    ]);
    expect(out.mainArea).toBe("Malviya Nagar");
  });

  it("level_2 is used when it is the only locality level", () => {
    expect(
      parseGoogleAddressComponents([
        comp("Asharfi Colony", ["sublocality_level_2", "sublocality", "political"]),
        ...CITY_STATE_PIN,
      ]).mainArea
    ).toBe("Asharfi Colony");
  });

  it("a lone generic sublocality with no level type still works", () => {
    expect(
      parseGoogleAddressComponents([comp("Kakkad", ["sublocality", "political"]), ...CITY_STATE_PIN]).mainArea
    ).toBe("Kakkad");
  });

  it("the generic sublocality entry never picks a level-tagged component (level_3 alone gives no title)", () => {
    expect(
      parseGoogleAddressComponents([
        comp("Asharfi Colony", ["sublocality_level_3", "sublocality", "political"]),
        ...CITY_STATE_PIN,
      ]).mainArea
    ).toBe("");
  });

  it("level_2 beats a generic-only sublocality", () => {
    expect(
      parseGoogleAddressComponents([
        comp("Kakkad", ["sublocality", "political"]),
        comp("Khajrana", ["sublocality_level_2", "sublocality", "political"]),
        ...CITY_STATE_PIN,
      ]).mainArea
    ).toBe("Khajrana");
  });

  it("extracts city/district/state/pin and never returns them as mainArea", () => {
    const out = parseGoogleAddressComponents(CITY_STATE_PIN);
    expect(out.city).toBe("Indore");
    expect(out.district).toBe("Indore Division");
    expect(out.state).toBe("Madhya Pradesh");
    expect(out.pin).toBe("452016");
    expect(out.mainArea).toBe("");
  });

  it("returns empty mainArea when no locality type is present", () => {
    const out = parseGoogleAddressComponents([comp("Ring Road", ["route"]), ...CITY_STATE_PIN]);
    expect(out.mainArea).toBe("");
  });

  it("captures plus codes but never as mainArea", () => {
    const out = parseGoogleAddressComponents(PLUS_CODE_RESULT.address_components);
    expect(out.plusCode).toBe("PWD4+0X");
    expect(out.mainArea).toBe("");
  });

  it("returns all-empty strings for garbage input", () => {
    const empty = { mainArea: "", route: "", premise: "", city: "", district: "", state: "", pin: "", plusCode: "" };
    expect(parseGoogleAddressComponents(null)).toEqual(empty);
    expect(parseGoogleAddressComponents("x")).toEqual(empty);
    expect(parseGoogleAddressComponents([null, { types: "bad" }])).toEqual(empty);
  });
});

describe("pickMainAreaFromResults", () => {
  it("skips a plus-code-only first result and uses a later one", () => {
    expect(pickMainAreaFromResults([PLUS_CODE_RESULT, KHAJRANA_RESULT])).toBe("Khajrana");
  });

  it("returns empty string when no result has a main area", () => {
    expect(pickMainAreaFromResults([PLUS_CODE_RESULT])).toBe("");
    expect(pickMainAreaFromResults([])).toBe("");
    expect(pickMainAreaFromResults(undefined)).toBe("");
  });
});

describe("formatAddressForDisplay", () => {
  it("strips a leading plus code from a raw-only address and leaves mainArea empty", () => {
    const out = formatAddressForDisplay({ rawAddress: "pwd40+, Asharfi Colony, Khajrana, Indore" });
    expect(out.mainArea).toBe("");
    expect(out.formattedAddress).toBe("Asharfi Colony, Khajrana, Indore");
  });

  it("strips only the code token from a compound plus code, keeping the city", () => {
    expect(formatAddressForDisplay({ rawAddress: "7JMH+4X Indore, Madhya Pradesh, India" }).formattedAddress).toBe(
      "Indore, Madhya Pradesh, India"
    );
  });

  it("strips a space-separated leading plus code without losing the first locality", () => {
    expect(formatAddressForDisplay({ rawAddress: "pwd40+ Asharfi Colony, Khajrana" }).formattedAddress).toBe(
      "Asharfi Colony, Khajrana"
    );
  });

  it("leaves a raw address without a plus code unchanged", () => {
    const out = formatAddressForDisplay({ rawAddress: "Asharfi Colony, Khajrana, Indore" });
    expect(out).toEqual({ mainArea: "", formattedAddress: "Asharfi Colony, Khajrana, Indore" });
  });

  it("uses components for mainArea", () => {
    const out = formatAddressForDisplay({
      components: KHAJRANA_COMPONENTS,
      rawAddress: "pwd40+, Asharfi Colony, Khajrana, Indore",
    });
    expect(out.mainArea).toBe("Khajrana");
    expect(out.formattedAddress).toBe("Asharfi Colony, Khajrana, Indore");
  });

  it("builds an address from components when no raw address is given", () => {
    const out = formatAddressForDisplay({ components: KHAJRANA_COMPONENTS });
    expect(out.mainArea).toBe("Khajrana");
    expect(out.formattedAddress).toBe("12, Ring Road, Khajrana, Indore, Madhya Pradesh 452016");
  });

  it("handles empty input", () => {
    expect(formatAddressForDisplay({})).toEqual({ mainArea: "", formattedAddress: "" });
    expect(formatAddressForDisplay()).toEqual({ mainArea: "", formattedAddress: "" });
  });
});

describe("resolveLocationTitle", () => {
  const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

  it("returns the main area for a good response and requests the exact latlng", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      okResponse({ status: "OK", results: [PLUS_CODE_RESULT, KHAJRANA_RESULT] })
    );
    const title = await resolveLocationTitle(22.7365123, 75.9087456, { fetchImpl, apiKey: "k" });
    expect(title).toBe("Khajrana");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0][0];
    expect(url).toContain("latlng=22.7365123,75.9087456");
    expect(url).toContain("language=en");
  });

  it("passes string coordinates through untouched", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ status: "OK", results: [KHAJRANA_RESULT] }));
    await resolveLocationTitle("22.70000", "75.80000", { fetchImpl, apiKey: "k" });
    expect(fetchImpl.mock.calls[0][0]).toContain("latlng=22.70000,75.80000");
  });

  it("returns null without an api key and does not call fetch", async () => {
    const saved = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchImpl = jest.fn();
    try {
      expect(await resolveLocationTitle(22.7, 75.8, { fetchImpl })).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.GOOGLE_MAPS_API_KEY = saved;
    }
  });

  it("returns null when fetch rejects", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("network down"));
    expect(await resolveLocationTitle(22.7, 75.8, { fetchImpl, apiKey: "k" })).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await resolveLocationTitle(22.7, 75.8, { fetchImpl, apiKey: "k" })).toBeNull();
  });

  it("returns null for ZERO_RESULTS and OVER_QUERY_LIMIT", async () => {
    for (const status of ["ZERO_RESULTS", "OVER_QUERY_LIMIT"]) {
      const fetchImpl = jest.fn().mockResolvedValue(okResponse({ status, results: [KHAJRANA_RESULT] }));
      expect(await resolveLocationTitle(22.7, 75.8, { fetchImpl, apiKey: "k" })).toBeNull();
    }
  });

  it("returns null for invalid JSON", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });
    expect(await resolveLocationTitle(22.7, 75.8, { fetchImpl, apiKey: "k" })).toBeNull();
  });

  it("returns null when no result has a main area", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ status: "OK", results: [PLUS_CODE_RESULT] }));
    expect(await resolveLocationTitle(22.7, 75.8, { fetchImpl, apiKey: "k" })).toBeNull();
  });

  it("returns null when fetch never resolves (timeout)", async () => {
    const fetchImpl = jest.fn(() => new Promise(() => {}));
    const started = Date.now();
    expect(await resolveLocationTitle(22.7, 75.8, { fetchImpl, apiKey: "k", timeoutMs: 20 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
