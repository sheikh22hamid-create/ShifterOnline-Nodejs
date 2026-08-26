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
});

describe("lockManager.withSelectionLock", () => {
  it("serializes concurrent critical sections instead of interleaving them", async () => {
    const order = [];

    const task = (id) =>
      lockManager.withSelectionLock(async () => {
        order.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end-${id}`);
      });

    await Promise.all([task("A"), task("B")]);

    expect(order).toEqual(["start-A", "end-A", "start-B", "end-B"]);
  });
});
