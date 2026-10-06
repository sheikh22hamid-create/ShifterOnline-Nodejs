jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/trackLinkService", () => ({
  isTokenShape: jest.requireActual("../../services/trackLinkService").isTokenShape,
  findByToken: jest.fn(), touchViewed: jest.fn(),
}));
jest.mock("../../services/trackSnapshotService", () => ({ buildSnapshot: jest.fn() }));
jest.mock("../../services/receiverTrackSettings", () => ({ getMapConfig: jest.fn(() => ({ tileUrl: "https://t/{z}/{x}/{y}.png?key=abc12345", attribution: "a" })) }));
jest.mock("../../config/db", () => ({}));

const links = require("../../services/trackLinkService");
const { buildSnapshot } = require("../../services/trackSnapshotService");
const c = require("../trackController");

const TOKEN = "t".repeat(43);
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() });
beforeEach(() => jest.clearAllMocks());

describe("snapshot", () => {
  it("rejects a malformed token with the invalid shape and never touches the DB", async () => {
    const r = res();
    await c.snapshot({ params: { token: "../etc/passwd" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ state: "invalid", poll_ms: 15000 });
    expect(links.findByToken).not.toHaveBeenCalled();
  });
  it("unknown token -> 404 with the same shape", async () => {
    links.findByToken.mockResolvedValue(null);
    const r = res();
    await c.snapshot({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ state: "invalid", poll_ms: 15000 });
  });
  it("returns the snapshot, no-store, and records the view", async () => {
    links.findByToken.mockResolvedValue({ id: 3, order_id: 50 });
    buildSnapshot.mockResolvedValue({ state: "active", step: 3 });
    const r = res();
    await c.snapshot({ params: { token: TOKEN } }, r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }));
    expect(r.json).toHaveBeenCalledWith({ state: "active", step: 3 });
    expect(links.touchViewed).toHaveBeenCalledWith(3);
  });
  it("a builder failure is a 500 with state error", async () => {
    links.findByToken.mockResolvedValue({ id: 3, order_id: 50 });
    buildSnapshot.mockRejectedValue(new Error("boom"));
    const r = res();
    await c.snapshot({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
    expect(r.json).toHaveBeenCalledWith({ state: "error", poll_ms: 15000 });
  });
});

describe("page", () => {
  it("serves HTML with the privacy headers", () => {
    const r = res();
    c.page({ params: { token: TOKEN } }, r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "Referrer-Policy": "strict-origin", "X-Robots-Tag": "noindex" }));
    expect(r.send).toHaveBeenCalledWith(expect.stringContaining("<!doctype html>"));
  });
  it("404s a malformed token", () => {
    const r = res();
    c.page({ params: { token: "x" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
  it("the 404 is JSON (not labelled text/html) and the page is labelled text/html", () => {
    const bad = res();
    c.page({ params: { token: "x" } }, bad);
    const sent = bad.set.mock.calls.map(([h]) => h).filter(Boolean);
    expect(sent.some((h) => String(h["Content-Type"] || "").startsWith("text/html"))).toBe(false);
    const good = res();
    c.page({ params: { token: TOKEN } }, good);
    expect(good.set).toHaveBeenCalledWith(expect.objectContaining({ "Content-Type": "text/html; charset=utf-8" }));
  });
  it("the malformed-token 404 also carries the no-store / noindex headers", () => {
    const r = res();
    c.page({ params: { token: "x" } }, r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }));
  });
});
