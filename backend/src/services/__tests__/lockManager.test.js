const lockManager = require("../lockManager");

describe("lockManager driver popup lock", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("grants a lock to a free driver and rejects a second concurrent lock", () => {
    expect(lockManager.acquireLock("r1", 297, 15000)).toBe(true);
    expect(lockManager.acquireLock("r1", 298, 15000)).toBe(false);
    expect(lockManager.isLocked("r1")).toBe(true);
    lockManager.releaseLock("r1");
    expect(lockManager.isLocked("r1")).toBe(false);
  });

  it("auto-expires a lock once its duration elapses", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
    lockManager.acquireLock("r2", 300, 15000);
    expect(lockManager.isLocked("r2")).toBe(true);

    jest.setSystemTime(new Date("2026-01-01T00:00:15.001Z"));
    expect(lockManager.isLocked("r2")).toBe(false);
    expect(lockManager.acquireLock("r2", 301, 15000)).toBe(true);
  });

  it("peekLock still finds a lock at the exact instant it elapses, unlike isLocked", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
    lockManager.acquireLock("r-exact", 500, 15000);

    jest.setSystemTime(new Date("2026-01-01T00:00:15.000Z"));
    // peekLock must be checked before isLocked: isLocked lazily deletes
    // expired entries as a side effect of reading them.
    expect(lockManager.peekLock("r-exact")).toEqual({ orderId: 500, expiresAt: expect.any(Number) });
    expect(lockManager.isLocked("r-exact")).toBe(false);

    lockManager.releaseLock("r-exact");
  });

  it("getLockedRidersForOrder returns only riders still locked to that order", () => {
    lockManager.acquireLock("r3", 400, 15000);
    lockManager.acquireLock("r4", 400, 15000);
    lockManager.acquireLock("r5", 401, 15000);

    const riders = lockManager.getLockedRidersForOrder(400).sort();
    expect(riders).toEqual(["r3", "r4"]);

    lockManager.releaseLock("r3");
    lockManager.releaseLock("r4");
    lockManager.releaseLock("r5");
  });

  it("acquireLock is atomic under concurrent contention: exactly one of two racing callers wins", async () => {
    // No global mutex exists anymore — this is what actually guarantees
    // "only one order gets a given driver": acquireLock is synchronous
    // (no `await` inside it), so two callers "racing" for the same rider
    // can never truly interleave; whichever's call executes first wins.
    const results = await Promise.all([
      Promise.resolve().then(() => lockManager.acquireLock("r-race", 600, 15000)),
      Promise.resolve().then(() => lockManager.acquireLock("r-race", 601, 15000)),
    ]);

    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(lockManager.isLocked("r-race")).toBe(true);

    lockManager.releaseLock("r-race");
  });
});
