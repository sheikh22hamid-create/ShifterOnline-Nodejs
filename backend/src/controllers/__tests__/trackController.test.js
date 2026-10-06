jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/trackLinkService", () => ({
  isTokenShape: jest.requireActual("../../services/trackLinkService").isTokenShape,
  findByToken: jest.fn(), touchViewed: jest.fn(),
}));
jest.mock("../../services/trackSnapshotService", () => ({ buildSnapshot: jest.fn() }));
jest.mock("../../services/receiverTrackSettings", () => ({ getMapConfig: jest.fn(() => ({ tileUrl: "https://t/{z}/{x}/{y}.png?key=abc12345", attribution: "a" })) }));
jest.mock("../../services/trackActionService", () => {
  class TrackActionError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { TrackActionError, mintPayLink: jest.fn(), submitReview: jest.fn() };
});
jest.mock("../../config/db", () => ({}));

const links = require("../../services/trackLinkService");
const { buildSnapshot } = require("../../services/trackSnapshotService");
const actions = require("../../services/trackActionService");
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

describe("payLink / review handlers", () => {
  const post = (body) => ({ params: { token: TOKEN }, body });
  beforeEach(() => links.findByToken.mockResolvedValue({ id: 3, order_id: 50, receiver_phone: "9876543210" }));

  it.each(["payLink", "review"])("%s rejects a malformed token with a 404 before any lookup", async (name) => {
    const r = res();
    await c[name]({ params: { token: "../x" }, body: {} }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(links.findByToken).not.toHaveBeenCalled();
  });
  it.each(["payLink", "review"])("%s answers 404 for an unknown token", async (name) => {
    links.findByToken.mockResolvedValue(null);
    const r = res();
    await c[name](post({}), r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ ok: false, code: "NOT_AVAILABLE", message: "This link is no longer available." });
  });
  it("payLink returns the url with no-store headers", async () => {
    actions.mintPayLink.mockResolvedValue({ link: "https://x/pay/t" });
    const r = res();
    await c.payLink(post({}), r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }));
    expect(r.json).toHaveBeenCalledWith({ ok: true, url: "https://x/pay/t" });
  });
  it("review passes the body to the service and answers ok", async () => {
    actions.submitReview.mockResolvedValue({ ok: true });
    const r = res();
    await c.review(post({ driver_rating: 5 }), r);
    expect(actions.submitReview).toHaveBeenCalledWith({ id: 3, order_id: 50, receiver_phone: "9876543210" }, { driver_rating: 5 });
    expect(r.json).toHaveBeenCalledWith({ ok: true });
  });
  it("maps a TrackActionError to its status and code", async () => {
    actions.submitReview.mockRejectedValue(new actions.TrackActionError("ALREADY_SUBMITTED", "dup", 409));
    const r = res();
    await c.review(post({ driver_rating: 5 }), r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json).toHaveBeenCalledWith({ ok: false, code: "ALREADY_SUBMITTED", message: "dup" });
  });
  it("an unexpected error is a generic 500", async () => {
    actions.mintPayLink.mockRejectedValue(new Error("secret db detail"));
    const r = res();
    await c.payLink(post({}), r);
    expect(r.status).toHaveBeenCalledWith(500);
    expect(r.json).toHaveBeenCalledWith({ ok: false, code: "ERROR", message: "Something went wrong. Please try again." });
  });
});

