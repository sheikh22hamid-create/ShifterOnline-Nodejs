const { DEFAULT_HOW_TO_USE_URL, resolveHowToUseUrl } = require("../howToUse");

describe("resolveHowToUseUrl", () => {
  it("uses the admin link when it is a web link, trimmed", () => {
    expect(resolveHowToUseUrl("  https://youtu.be/abc  ")).toBe("https://youtu.be/abc");
    expect(resolveHowToUseUrl("http://example.com/t")).toBe("http://example.com/t");
  });

  it("falls back to the company default when missing, empty or not a web link", () => {
    for (const v of [undefined, null, "", "   ", "not a url", "javascript:alert(1)", "ftp://x.y/z"]) {
      expect(resolveHowToUseUrl(v)).toBe(DEFAULT_HOW_TO_USE_URL);
    }
  });

  it("never falls back to a third-party video", () => {
    expect(DEFAULT_HOW_TO_USE_URL).not.toMatch(/youtube|youtu\.be/i);
  });
});
