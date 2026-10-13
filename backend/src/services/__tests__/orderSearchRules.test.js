const rules = require("../orderSearchRules");

describe("defaultSettings / normalizeRow", () => {
  it("a missing row means System 1, guarantee off, 60 s", () => {
    expect(rules.normalizeRow(null)).toEqual({
      searchSystem: 1, searchRadiusKm: null, driverSearchSeconds: 60,
      guaranteeEnabled: false, adminWindowMinutes: null, guaranteeReferralsRequired: 1,
      guaranteeStartTime: null, guaranteeEndTime: null,
    });
  });

  it("reads a valid row", () => {
    expect(rules.normalizeRow({
      search_system: 2, search_radius_km: "7.50", driver_search_seconds: 120, guarantee_enabled: 1,
      admin_window_minutes: 15, guarantee_referrals_required: 2,
    })).toEqual({
      searchSystem: 2, searchRadiusKm: 7.5, driverSearchSeconds: 120,
      guaranteeEnabled: true, adminWindowMinutes: 15, guaranteeReferralsRequired: 2,
      guaranteeStartTime: null, guaranteeEndTime: null,
    });
  });

  it("falls back per field when a stored value is out of range", () => {
    const s = rules.normalizeRow({
      search_system: 9, search_radius_km: 99, driver_search_seconds: 5, guarantee_enabled: 0,
      admin_window_minutes: 0, guarantee_referrals_required: 0,
    });
    expect(s.searchSystem).toBe(1);
    expect(s.searchRadiusKm).toBeNull();
    expect(s.driverSearchSeconds).toBe(60);
    expect(s.adminWindowMinutes).toBeNull();
    expect(s.guaranteeReferralsRequired).toBe(1);
  });
});

describe("validateSettingsInput", () => {
  it("returns only the keys that were sent", () => {
    expect(rules.validateSettingsInput({ searchSystem: "2", driverSearchSeconds: "90" })).toEqual({ searchSystem: 2, driverSearchSeconds: 90 });
  });

  it("blank radius and blank admin window clear back to the fallback (null)", () => {
    expect(rules.validateSettingsInput({ searchRadiusKm: "", adminWindowMinutes: null })).toEqual({ searchRadiusKm: null, adminWindowMinutes: null });
  });

  it("parses the guarantee switch", () => {
    expect(rules.validateSettingsInput({ guaranteeEnabled: true }).guaranteeEnabled).toBe(true);
    expect(rules.validateSettingsInput({ guaranteeEnabled: "1" }).guaranteeEnabled).toBe(true);
    expect(rules.validateSettingsInput({ guaranteeEnabled: false }).guaranteeEnabled).toBe(false);
    expect(rules.validateSettingsInput({ guaranteeEnabled: "0" }).guaranteeEnabled).toBe(false);
  });

  it.each([
    [{ searchSystem: 3 }, "search_system"],
    [{ searchSystem: "" }, "search_system"],
    [{ searchRadiusKm: 0.5 }, "search_radius_km"],
    [{ searchRadiusKm: 31 }, "search_radius_km"],
    [{ searchRadiusKm: "abc" }, "search_radius_km"],
    [{ driverSearchSeconds: 14 }, "driver_search_seconds"],
    [{ driverSearchSeconds: 601 }, "driver_search_seconds"],
    [{ driverSearchSeconds: 60.5 }, "driver_search_seconds"],
    [{ driverSearchSeconds: "" }, "driver_search_seconds"],
    [{ driverSearchSeconds: -30 }, "driver_search_seconds"],
    [{ adminWindowMinutes: 0 }, "admin_window_minutes"],
    [{ adminWindowMinutes: 1441 }, "admin_window_minutes"],
    [{ adminWindowMinutes: 2.5 }, "admin_window_minutes"],
    [{ guaranteeReferralsRequired: 0 }, "guarantee_referrals_required"],
    [{ guaranteeReferralsRequired: 1.5 }, "guarantee_referrals_required"],
    [{ guaranteeReferralsRequired: "" }, "guarantee_referrals_required"],
  ])("rejects %j with a 400 naming %s", (input, field) => {
    let err;
    try { rules.validateSettingsInput(input); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain(field);
  });
});

describe("deadline helpers", () => {
  it("searchDeadline adds whole seconds", () => {
    const now = new Date("2026-10-12T10:00:00.000Z");
    expect(rules.searchDeadline(now, 90).toISOString()).toBe("2026-10-12T10:01:30.000Z");
  });

  it("isSystem2Order is true only for search_system 2", () => {
    expect(rules.isSystem2Order({ search_system: 2 })).toBe(true);
    expect(rules.isSystem2Order({ search_system: "2" })).toBe(true);
    expect(rules.isSystem2Order({ search_system: 1 })).toBe(false);
    expect(rules.isSystem2Order({ search_system: null })).toBe(false);
    expect(rules.isSystem2Order(null)).toBe(false);
  });

  it("hasSearchTimeLeft needs System 2 and a future deadline", () => {
    const now = new Date("2026-10-12T10:00:00.000Z");
    expect(rules.hasSearchTimeLeft({ search_system: 2, search_deadline_at: "2026-10-12T10:00:01.000Z" }, now)).toBe(true);
    expect(rules.hasSearchTimeLeft({ search_system: 2, search_deadline_at: "2026-10-12T10:00:00.000Z" }, now)).toBe(false);
    expect(rules.hasSearchTimeLeft({ search_system: 2, search_deadline_at: null }, now)).toBe(false);
    expect(rules.hasSearchTimeLeft({ search_system: 1, search_deadline_at: "2026-10-12T11:00:00.000Z" }, now)).toBe(false);
  });

  describe("guarantee time window", () => {
    // IST = UTC + 5:30, so 10:00 IST is 04:30 UTC.
    const at = (hh, mm) => new Date(Date.UTC(2026, 9, 13, hh, mm) - 330 * 60 * 1000);
    const win = (s, e) => ({ guaranteeStartTime: s, guaranteeEndTime: e });

    it("no window (or a half-set one) means all day", () => {
      expect(rules.isWithinGuaranteeWindow(win(null, null), at(3, 0))).toBe(true);
      expect(rules.isWithinGuaranteeWindow(win("09:00", null), at(3, 0))).toBe(true);
    });
    it("same-day window: start inclusive, end exclusive", () => {
      expect(rules.isWithinGuaranteeWindow(win("09:00", "18:00"), at(9, 0))).toBe(true);
      expect(rules.isWithinGuaranteeWindow(win("09:00", "18:00"), at(17, 59))).toBe(true);
      expect(rules.isWithinGuaranteeWindow(win("09:00", "18:00"), at(18, 0))).toBe(false);
      expect(rules.isWithinGuaranteeWindow(win("09:00", "18:00"), at(8, 59))).toBe(false);
    });
    it("overnight window wraps past midnight", () => {
      expect(rules.isWithinGuaranteeWindow(win("22:00", "06:00"), at(23, 30))).toBe(true);
      expect(rules.isWithinGuaranteeWindow(win("22:00", "06:00"), at(2, 0))).toBe(true);
      expect(rules.isWithinGuaranteeWindow(win("22:00", "06:00"), at(12, 0))).toBe(false);
    });
    it("normalizeRow keeps a full window and drops a half-set one", () => {
      expect(rules.normalizeRow({ guarantee_start_time: "09:00", guarantee_end_time: "18:00" })).toMatchObject(win("09:00", "18:00"));
      expect(rules.normalizeRow({ guarantee_start_time: "09:00" })).toMatchObject(win(null, null));
    });
    it("validateSettingsInput requires both, valid HH:MM, and different values; blank clears", () => {
      expect(rules.validateSettingsInput({ guaranteeStartTime: "09:00", guaranteeEndTime: "18:00" })).toEqual(win("09:00", "18:00"));
      expect(rules.validateSettingsInput({ guaranteeStartTime: "", guaranteeEndTime: "" })).toEqual(win(null, null));
      expect(() => rules.validateSettingsInput({ guaranteeStartTime: "09:00", guaranteeEndTime: "" })).toThrow(/together/);
      expect(() => rules.validateSettingsInput({ guaranteeStartTime: "9am", guaranteeEndTime: "18:00" })).toThrow(/HH:MM/);
      expect(() => rules.validateSettingsInput({ guaranteeStartTime: "09:00", guaranteeEndTime: "09:00" })).toThrow(/same/);
    });
  });

  it("isInstantBookingType treats scheduled and next-day values as not instant", () => {
    for (const v of [1, "1", "now", "instant", undefined, null]) expect(rules.isInstantBookingType(v)).toBe(true);
    for (const v of [2, "2", 3, "3", "scheduled", "next_day", "nextday", "Scheduled"]) expect(rules.isInstantBookingType(v)).toBe(false);
  });
});
