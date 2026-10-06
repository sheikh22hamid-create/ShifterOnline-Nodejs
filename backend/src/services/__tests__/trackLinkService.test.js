jest.mock("../../config/db", () => ({
  order_track_link: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
const prisma = require("../../config/db");
const svc = require("../trackLinkService");

const TOKEN = "t".repeat(43);
const row = (o = {}) => ({ id: 1, order_id: 50, token: TOKEN, receiver_phone: "9876543210", created_at: new Date(), ...o });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PUBLIC_BASE_URL = "https://api.example.com/";
});

describe("isTokenShape", () => {
  it("accepts 43 base64url chars only", () => {
    expect(svc.isTokenShape(TOKEN)).toBe(true);
    for (const bad of ["", "abc", "../etc/passwd", "t".repeat(42), "t".repeat(44), "t".repeat(42) + "!", null, undefined]) {
      expect(svc.isTokenShape(bad)).toBe(false);
    }
  });
});

describe("getOrCreate", () => {
  it("creates a link with a fresh 43-char token and the normalised phone", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(null);
    prisma.order_track_link.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    const out = await svc.getOrCreate(50, "+91 98765 43210");
    expect(out.receiver_phone).toBe("9876543210");
    expect(svc.isTokenShape(out.token)).toBe(true);
    expect(prisma.order_track_link.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ order_id: 50, receiver_phone: "9876543210", created_at: expect.any(Date) }),
    });
  });
  it("is idempotent for the same phone", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(row());
    const out = await svc.getOrCreate(50, "9876543210");
    expect(out.token).toBe(TOKEN);
    expect(prisma.order_track_link.create).not.toHaveBeenCalled();
    expect(prisma.order_track_link.update).not.toHaveBeenCalled();
  });
  it("rotates the token when the phone changed, so the old link dies", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(row());
    prisma.order_track_link.update.mockImplementation(({ data }) => Promise.resolve(row(data)));
    const out = await svc.getOrCreate(50, "9000000000");
    expect(out.receiver_phone).toBe("9000000000");
    expect(out.token).not.toBe(TOKEN);
    expect(prisma.order_track_link.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { token: expect.any(String), receiver_phone: "9000000000" },
    });
  });
  it("returns null for a missing or short phone without touching the DB", async () => {
    expect(await svc.getOrCreate(50, "")).toBeNull();
    expect(await svc.getOrCreate(50, "12345")).toBeNull();
    expect(prisma.order_track_link.findUnique).not.toHaveBeenCalled();
  });
  it("recovers from losing a create race", async () => {
    prisma.order_track_link.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    prisma.order_track_link.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect((await svc.getOrCreate(50, "9876543210")).token).toBe(TOKEN);
  });
  it("rethrows other create errors", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(null);
    prisma.order_track_link.create.mockRejectedValue(new Error("boom"));
    await expect(svc.getOrCreate(50, "9876543210")).rejects.toThrow("boom");
  });
});

describe("findByToken", () => {
  it("does not query for a malformed token", async () => {
    expect(await svc.findByToken("nope")).toBeNull();
    expect(prisma.order_track_link.findUnique).not.toHaveBeenCalled();
  });
  it("looks a well-formed token up", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(row());
    expect((await svc.findByToken(TOKEN)).order_id).toBe(50);
    expect(prisma.order_track_link.findUnique).toHaveBeenCalledWith({ where: { token: TOKEN } });
  });
});

describe("buildLink / touchViewed", () => {
  it("joins PUBLIC_BASE_URL without a double slash", () => {
    expect(svc.buildLink(TOKEN)).toBe(`https://api.example.com/track/${TOKEN}`);
  });
  it("is null when PUBLIC_BASE_URL is not configured", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(svc.buildLink(TOKEN)).toBeNull();
  });
  it("touchViewed never throws", async () => {
    prisma.order_track_link.update.mockRejectedValue(new Error("db"));
    await expect(svc.touchViewed(1001, 0)).resolves.toBeUndefined();
  });
  it("touchViewed skips the write if the same link was touched under 60 s ago", async () => {
    prisma.order_track_link.update.mockResolvedValue({});
    await svc.touchViewed(2001, 1000000);
    await svc.touchViewed(2001, 1000000 + 59000);
    expect(prisma.order_track_link.update).toHaveBeenCalledTimes(1);
    await svc.touchViewed(2002, 1000000 + 59000);
    expect(prisma.order_track_link.update).toHaveBeenCalledTimes(2);
  });
  it("touchViewed writes again after 60 s", async () => {
    prisma.order_track_link.update.mockResolvedValue({});
    await svc.touchViewed(3001, 5000000);
    await svc.touchViewed(3001, 5000000 + 61000);
    expect(prisma.order_track_link.update).toHaveBeenCalledTimes(2);
  });
  it("a failed write still counts as attempted and does not throw", async () => {
    prisma.order_track_link.update.mockRejectedValue(new Error("db"));
    await svc.touchViewed(4001, 9000000);
    await svc.touchViewed(4001, 9000000 + 1000);
    expect(prisma.order_track_link.update).toHaveBeenCalledTimes(1);
  });
});
