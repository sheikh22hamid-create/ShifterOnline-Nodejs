const r = require("../guaranteeQueueRules");

const cand = (adminId, o = {}) => ({ adminId, available: true, capacity: null, load: 0, lastAssignedAt: null, ...o });
const at = (iso) => new Date(iso);

describe("normalizeQueueRow", () => {
  it("returns the defaults (OFF, 5, 50, 75, no idle reassign) for a missing row", () => {
    expect(r.normalizeQueueRow(null)).toEqual({ execQueueEnabled: false, recoverOnDriverCancel: false, autoOutsideSearch: false, execDefaultCapacity: 5, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
  });
  it("reads a stored row and falls back per field on bad values", () => {
    expect(r.normalizeQueueRow({ exec_queue_enabled: 1, exec_default_capacity: 8, reminder_pct: 40, escalate_pct: 80, auto_reassign_idle_minutes: 7 }))
      .toEqual({ execQueueEnabled: true, recoverOnDriverCancel: false, autoOutsideSearch: false, execDefaultCapacity: 8, reminderPct: 40, escalatePct: 80, autoReassignIdleMinutes: 7 });
    expect(r.normalizeQueueRow({ exec_queue_enabled: 1, exec_default_capacity: 0, reminder_pct: 90, escalate_pct: 10, auto_reassign_idle_minutes: -3 }))
      .toEqual({ execQueueEnabled: true, recoverOnDriverCancel: false, autoOutsideSearch: false, execDefaultCapacity: 5, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
  });
});

describe("validateQueueInput", () => {
  it("accepts a valid partial update and only returns the keys sent", () => {
    expect(r.validateQueueInput({ execQueueEnabled: "true", execDefaultCapacity: "6" })).toEqual({ execQueueEnabled: true, execDefaultCapacity: 6 });
  });
  it("rejects capacity < 1, non-integers and absurd values with a 400", () => {
    for (const v of [0, -1, 1.5, "x", 201]) {
      expect(() => r.validateQueueInput({ execDefaultCapacity: v })).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
  it("requires 0 < reminder < escalate < 100, checking against the current values for a partial update", () => {
    expect(() => r.validateQueueInput({ reminderPct: 80 }, { ...r.DEFAULTS, escalatePct: 75 })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => r.validateQueueInput({ escalatePct: 100 })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(r.validateQueueInput({ reminderPct: 30, escalatePct: 60 })).toEqual({ reminderPct: 30, escalatePct: 60 });
  });
  it("allows clearing idle auto-reassign with null/blank and rejects 0", () => {
    expect(r.validateQueueInput({ autoReassignIdleMinutes: "" })).toEqual({ autoReassignIdleMinutes: null });
    expect(() => r.validateQueueInput({ autoReassignIdleMinutes: 0 })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe("rankCandidates", () => {
  it("excludes unavailable executives and those at capacity (default capacity 5, profile capacity wins)", () => {
    const ranked = r.rankCandidates([
      cand(1, { available: false }), cand(2, { load: 5 }), cand(3, { load: 2, capacity: 2 }), cand(4, { load: 1 }),
    ], 5);
    expect(ranked.map((c) => c.adminId)).toEqual([4]);
  });
  it("prefers the lowest load/capacity ratio, then the longest-idle (NULL first), then the lowest id", () => {
    const ranked = r.rankCandidates([
      cand(10, { load: 2, capacity: 4 }),                       // 0.5
      cand(11, { load: 1, capacity: 5, lastAssignedAt: at("2026-10-14T10:00:00Z") }), // 0.2
      cand(12, { load: 1, capacity: 5, lastAssignedAt: at("2026-10-14T09:00:00Z") }), // 0.2, idle longer
      cand(13, { load: 1, capacity: 5, lastAssignedAt: null }),                       // 0.2, never assigned
      cand(9,  { load: 1, capacity: 5, lastAssignedAt: null }),                       // tie with 13 -> lower id
    ], 5);
    expect(ranked.map((c) => c.adminId)).toEqual([9, 13, 12, 11, 10]);
  });
});

describe("unassignedReason", () => {
  it("distinguishes nobody in the city, nobody available, and everyone full", () => {
    expect(r.unassignedReason([], 5)).toBe("none_in_city");
    expect(r.unassignedReason([cand(1, { available: false }), cand(2, { available: false })], 5)).toBe("all_unavailable");
    expect(r.unassignedReason([cand(1, { load: 5 }), cand(2, { available: false })], 5)).toBe("all_at_capacity");
  });
});

describe("SLA thresholds", () => {
  const base = { opened_at: at("2026-10-14T10:00:00Z"), deadline_at: at("2026-10-14T10:10:00Z"), reminded_at: null, escalated_at: null,
    owner_assigned_at: at("2026-10-14T10:00:30Z"), last_action_at: null };
  const city = { reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: 3 };
  it("computes elapsed percent of the original window and clamps it", () => {
    expect(r.elapsedPct(base, at("2026-10-14T10:05:00Z"))).toBe(50);
    expect(r.elapsedPct(base, at("2026-10-14T09:00:00Z"))).toBe(0);
    expect(r.elapsedPct(base, at("2026-10-14T11:00:00Z"))).toBe(100);
  });
  it("fires reminder at 50% and escalation at 75% exactly once (sent flags suppress them)", () => {
    expect(r.isReminderDue(base, city, at("2026-10-14T10:04:59Z"))).toBe(false);
    expect(r.isReminderDue(base, city, at("2026-10-14T10:05:00Z"))).toBe(true);
    expect(r.isReminderDue({ ...base, reminded_at: at("2026-10-14T10:05:01Z") }, city, at("2026-10-14T10:06:00Z"))).toBe(false);
    expect(r.isEscalationDue(base, city, at("2026-10-14T10:07:29Z"))).toBe(false);
    expect(r.isEscalationDue(base, city, at("2026-10-14T10:07:30Z"))).toBe(true);
    expect(r.isEscalationDue({ ...base, escalated_at: at("2026-10-14T10:07:31Z") }, city, at("2026-10-14T10:08:00Z"))).toBe(false);
  });
  it("a zero-length window counts as fully elapsed (both due immediately)", () => {
    const z = { ...base, deadline_at: base.opened_at };
    expect(r.isReminderDue(z, city, at("2026-10-14T10:00:00Z"))).toBe(true);
    expect(r.isEscalationDue(z, city, at("2026-10-14T10:00:00Z"))).toBe(true);
  });
  it("idle = no meaningful action since the later of assignment and last action, and only if enough time remains", () => {
    const now = at("2026-10-14T10:04:00Z"); // 3.5 min after assignment, 6 min remaining
    expect(r.isIdle(base, city, now, 30000)).toBe(true);
    expect(r.isIdle({ ...base, last_action_at: at("2026-10-14T10:02:00Z") }, city, now, 30000)).toBe(false);
    expect(r.isIdle(base, { ...city, autoReassignIdleMinutes: null }, now, 30000)).toBe(false);
    expect(r.isIdle(base, city, at("2026-10-14T10:09:50Z"), 30000)).toBe(false); // only 10 s left
  });
});

describe("action classification", () => {
  it("only operational actions are meaningful; viewing never is; a note must be substantive", () => {
    expect(r.isMeaningful("viewed")).toBe(false);
    expect(r.isMeaningful("search_started")).toBe(true);
    expect(r.isMeaningful("driver_contacted")).toBe(true);
    expect(r.isMeaningful("contact_outcome")).toBe(true);
    expect(r.isMeaningful("note", "ok")).toBe(false);
    expect(r.isMeaningful("note", "Called three drivers in Sector 5, none free")).toBe(true);
    expect(r.ACTION_TYPES).toContain("escalated");
  });
});

describe("recoverOnDriverCancel setting", () => {
  it("defaults to OFF and reads the column", () => {
    expect(r.DEFAULTS.recoverOnDriverCancel).toBe(false);
    expect(r.normalizeQueueRow(null).recoverOnDriverCancel).toBe(false);
    expect(r.normalizeQueueRow({ guarantee_recover_on_cancel: 1 }).recoverOnDriverCancel).toBe(true);
    expect(r.normalizeQueueRow({ guarantee_recover_on_cancel: 0 }).recoverOnDriverCancel).toBe(false);
  });
  it("validates input as a boolean and returns it only when sent", () => {
    expect(r.validateQueueInput({ recoverOnDriverCancel: true })).toEqual({ recoverOnDriverCancel: true });
    expect(r.validateQueueInput({ recoverOnDriverCancel: "false" })).toEqual({ recoverOnDriverCancel: false });
    expect(r.validateQueueInput({})).toEqual({});
  });
});

describe("autoOutsideSearch setting", () => {
  it("defaults to OFF and reads the column", () => {
    expect(r.DEFAULTS.autoOutsideSearch).toBe(false);
    expect(r.normalizeQueueRow(null).autoOutsideSearch).toBe(false);
    expect(r.normalizeQueueRow({ exec_auto_outside_search: 1 }).autoOutsideSearch).toBe(true);
    expect(r.normalizeQueueRow({ exec_auto_outside_search: 0 }).autoOutsideSearch).toBe(false);
  });
  it("validates input as a boolean and returns it only when sent", () => {
    expect(r.validateQueueInput({ autoOutsideSearch: "true" })).toEqual({ autoOutsideSearch: true });
    expect(r.validateQueueInput({ autoOutsideSearch: 0 })).toEqual({ autoOutsideSearch: false });
    expect(r.validateQueueInput({})).toEqual({});
  });
});
