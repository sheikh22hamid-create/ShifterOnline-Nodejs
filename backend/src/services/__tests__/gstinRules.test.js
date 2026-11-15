const rules = require("../gstinRules");

describe("validate", () => {
  // Two publicly documented sample GSTINs (GSTN / GSP documentation): both pass, which proves the check-digit algorithm.
  it.each(["27AAPFU0939F1ZV", "07AAGFF2194N1Z1"])("%s is valid", (gstin) => {
    expect(rules.validate(gstin)).toMatchObject({ ok: true, gstin });
  });

  it("a number built with the algorithm validates for every state code (synthetic, not a real business)", () => {
    for (const code of Object.keys(rules.STATES)) {
      const first14 = `${code}AABCT1332L1Z`;
      expect(rules.validate(first14 + rules.checkChar(first14)).ok).toBe(true);
    }
  });

  it("cleans spaces, dashes and lower case", () => {
    expect(rules.validate(" 27aapfu0939f1zv ")).toMatchObject({ ok: true, gstin: "27AAPFU0939F1ZV", state: "Maharashtra", stateCode: "27", pan: "AAPFU0939F" });
    expect(rules.validate("27-AAPFU-0939-F1ZV").ok).toBe(true);
  });

  it.each([
    ["", "EMPTY"], [null, "EMPTY"], ["27AAPFU0939F1Z", "LENGTH"], ["27AAPFU0939F1ZVX", "LENGTH"],
    ["27AAPFU0939F1AV", "FORMAT"], // 14th character must be Z
    ["AAAAPFU0939F1ZV", "FORMAT"], // state code must be digits
    ["00AAPFU0939F1Z5", "STATE"], ["25AAPFU0939F1Z8", "STATE"],
    ["27AAPFU0939F1ZW", "CHECKSUM"], // one wrong check character
    ["27AAPFU0939F2ZV", "CHECKSUM"], // one wrong entity digit
  ])("rejects %p (%s)", (input, code) => {
    expect(rules.validate(input)).toMatchObject({ ok: false, code });
  });

  it("checkChar is the character a valid GSTIN ends with", () => {
    expect(rules.checkChar("27AAPFU0939F1Z")).toBe("V");
    expect(rules.checkChar("07AAGFF2194N1Z")).toBe("1");
  });
});

describe("normalizeTaxpayer", () => {
  const gstnStyle = {
    gstin: "27AAPFU0939F1ZV", lgnm: "ABC TRADERS PRIVATE LIMITED", tradeNam: "ABC Traders", sts: "Active", ctb: "Private Limited Company",
    pradr: { addr: { bno: "12", bnm: "Sunrise Tower", st: "MG Road", loc: "Andheri", dst: "Mumbai", stcd: "Maharashtra", pncd: "400053" } },
  };

  it("reads a GSTN searchTaxpayer-style answer", () => {
    expect(rules.normalizeTaxpayer(gstnStyle, "27AAPFU0939F1ZV")).toEqual({
      gstin: "27AAPFU0939F1ZV", legal_name: "ABC TRADERS PRIVATE LIMITED", trade_name: "ABC Traders",
      address: "12, Sunrise Tower, MG Road, Andheri, Mumbai, Maharashtra, 400053",
      state: "Maharashtra", state_code: "27", pincode: "400053", status: "Active", active: true,
    });
  });

  it("finds it inside the usual envelopes", () => {
    for (const wrapped of [{ taxpayerInfo: gstnStyle }, { data: gstnStyle }, { data: { taxpayerInfo: gstnStyle } }, { result: gstnStyle }]) {
      expect(rules.normalizeTaxpayer(wrapped, "27AAPFU0939F1ZV")?.legal_name).toBe("ABC TRADERS PRIVATE LIMITED");
    }
  });

  it("reads a flat snake_case / camelCase answer and a ready-made address string", () => {
    const flat = { gstin: "07AAGFF2194N1Z1", legal_name: "Foo & Sons", trade_name: "Foo", address: "5 Main Rd, Delhi 110001", status: "Active" };
    expect(rules.normalizeTaxpayer(flat, "07AAGFF2194N1Z1")).toMatchObject({ legal_name: "Foo & Sons", address: "5 Main Rd, Delhi 110001", state: "Delhi", state_code: "07", active: true });
    const camel = { gstIn: "07AAGFF2194N1Z1", legalName: "Foo & Sons", tradeName: "Foo", gstStatus: "Active" };
    expect(rules.normalizeTaxpayer(camel, "07AAGFF2194N1Z1")).toMatchObject({ legal_name: "Foo & Sons", trade_name: "Foo" });
  });

  it("a prebuilt principal-place address string wins over the parts", () => {
    const out = rules.normalizeTaxpayer({ lgnm: "X", pradr: { adr: "Full, Address 1", addr: { st: "ignored" } } }, "27AAPFU0939F1ZV");
    expect(out.address).toBe("Full, Address 1");
  });

  it("flags a cancelled or suspended registration as not active", () => {
    expect(rules.normalizeTaxpayer({ ...gstnStyle, sts: "Cancelled" }, "27AAPFU0939F1ZV").active).toBe(false);
    expect(rules.normalizeTaxpayer({ ...gstnStyle, sts: "Suspended" }, "27AAPFU0939F1ZV").active).toBe(false);
  });

  it("returns null when there is no legal name (nothing to show or autofill)", () => {
    expect(rules.normalizeTaxpayer({ error: true, message: "GSTIN not found" }, "27AAPFU0939F1ZV")).toBeNull();
    expect(rules.normalizeTaxpayer({ gstin: "27AAPFU0939F1ZV" }, "27AAPFU0939F1ZV")).toBeNull();
    expect(rules.normalizeTaxpayer(null, "x")).toBeNull();
    expect(rules.normalizeTaxpayer([gstnStyle], "x")).toBeNull();
  });

  it("derives the state from the GSTIN when the provider omits it", () => {
    expect(rules.normalizeTaxpayer({ lgnm: "X" }, "29AABCT1332L1Z0")).toMatchObject({ state: "Karnataka", state_code: "29" });
  });
});
