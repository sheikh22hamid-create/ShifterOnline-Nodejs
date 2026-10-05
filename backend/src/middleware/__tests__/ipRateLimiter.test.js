const { createIpRateLimiter } = require("../ipRateLimiter");

const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() });
const mkReq = (ip, xff) => ({ ip, headers: xff ? { "x-forwarded-for": xff } : {} });
const hit = (mw, req) => { const res = mkRes(); const next = jest.fn(); mw(req, res, next); return { res, next }; };

beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z")));
afterEach(() => jest.useRealTimers());

describe("ipRateLimiter", () => {
  it("allows up to max then returns 429 with Retry-After", () => {
    const mw = createIpRateLimiter({ name: "a", windowMs: 60000, max: 2 });
    expect(hit(mw, mkReq("1.1.1.1")).next).toHaveBeenCalled();
    expect(hit(mw, mkReq("1.1.1.1")).next).toHaveBeenCalled();
    const { res, next } = hit(mw, mkReq("1.1.1.1"));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ success: false, code: "RATE_LIMITED", message: "Too many requests, please try again shortly." });
    expect(res.set).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });
  it("separate limiters do not share counters", () => {
    const a = createIpRateLimiter({ name: "a", windowMs: 60000, max: 1 });
    const b = createIpRateLimiter({ name: "b", windowMs: 60000, max: 1 });
    hit(a, mkReq("1.1.1.1"));
    expect(hit(a, mkReq("1.1.1.1")).next).not.toHaveBeenCalled();
    expect(hit(b, mkReq("1.1.1.1")).next).toHaveBeenCalled();
  });
  it("keys on the rightmost x-forwarded-for hop; a spoofed leftmost value does not change the key", () => {
    const mw = createIpRateLimiter({ name: "a", windowMs: 60000, max: 1 });
    expect(hit(mw, mkReq("10.0.0.1", "6.6.6.6, 9.9.9.9")).next).toHaveBeenCalled();
    expect(hit(mw, mkReq("10.0.0.1", "7.7.7.7, 9.9.9.9 ")).next).not.toHaveBeenCalled();
    expect(hit(mw, mkReq("10.0.0.1", "6.6.6.6, 8.8.8.8")).next).toHaveBeenCalled();
  });
  it("handles array-valued x-forwarded-for headers", () => {
    const mw = createIpRateLimiter({ name: "a", windowMs: 60000, max: 1 });
    hit(mw, { ip: "x", headers: { "x-forwarded-for": ["1.1.1.1", "5.5.5.5"] } });
    expect(hit(mw, mkReq("x", "2.2.2.2, 5.5.5.5")).next).not.toHaveBeenCalled();
  });
  it("falls back to req.ip then 'unknown'", () => {
    const mw = createIpRateLimiter({ name: "a", windowMs: 60000, max: 1 });
    hit(mw, { headers: {} });
    expect(hit(mw, { headers: {} }).next).not.toHaveBeenCalled();
    expect(hit(mw, mkReq("2.2.2.2")).next).toHaveBeenCalled();
  });
  it("resets after the window", () => {
    const mw = createIpRateLimiter({ name: "a", windowMs: 60000, max: 1 });
    hit(mw, mkReq("1.1.1.1"));
    expect(hit(mw, mkReq("1.1.1.1")).next).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60001);
    expect(hit(mw, mkReq("1.1.1.1")).next).toHaveBeenCalled();
  });
  it("prunes expired keys so the map cannot grow unbounded", () => {
    const mw = createIpRateLimiter({ name: "a", windowMs: 1000, max: 5 });
    for (let i = 0; i < 1001; i++) hit(mw, mkReq(`ip${i}`));
    expect(mw._size()).toBe(1001);
    jest.advanceTimersByTime(1500);
    hit(mw, mkReq("fresh"));
    expect(mw._size()).toBe(1);
  });
});
