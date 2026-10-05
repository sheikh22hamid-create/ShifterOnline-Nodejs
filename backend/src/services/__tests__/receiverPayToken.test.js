const { mintToken, hashToken } = require("../receiverPayToken");

describe("receiverPayToken", () => {
  it("mints a url-safe token and its sha256 hash", () => {
    const { token, hash } = mintToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
  });
  it("never repeats", () => expect(mintToken().token).not.toBe(mintToken().token));
});
