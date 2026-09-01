const legacyAuth = require("../legacyAuth");

describe("legacyAuth", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  function mockRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() };
  }

  it("rejects with 503 when LEGACY_BRIDGE_SECRET is not configured", () => {
    delete process.env.LEGACY_BRIDGE_SECRET;
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    legacyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the header is missing or wrong", () => {
    process.env.LEGACY_BRIDGE_SECRET = "correct-secret";
    const req = { headers: { "x-legacy-bridge-secret": "wrong" } };
    const res = mockRes();
    const next = jest.fn();

    legacyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the header matches", () => {
    process.env.LEGACY_BRIDGE_SECRET = "correct-secret";
    const req = { headers: { "x-legacy-bridge-secret": "correct-secret" } };
    const res = mockRes();
    const next = jest.fn();

    legacyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
