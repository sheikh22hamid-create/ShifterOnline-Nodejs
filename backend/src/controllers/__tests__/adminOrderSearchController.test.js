jest.mock("../../services/orderSearchSettings", () => ({ getCitySettings: jest.fn(), saveCitySettings: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const settings = require("../../services/orderSearchSettings");
const ctrl = require("../adminOrderSearchController");

const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const s = { searchSystem: 2, searchRadiusKm: 7, driverSearchSeconds: 90, guaranteeEnabled: true, adminWindowMinutes: 20, guaranteeReferralsRequired: 2 };
const wire = { search_system: 2, search_radius_km: 7, driver_search_seconds: 90, guarantee_enabled: true, admin_window_minutes: 20, guarantee_referrals_required: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  settings.getCitySettings.mockResolvedValue(s);
  settings.saveCitySettings.mockResolvedValue(s);
});

describe("getSettings", () => {
  it("a city admin reads their own city, ignoring any city_id they send", async () => {
    const r = res();
    await ctrl.getSettings({ user: { role: "admin", city_id: 3 }, query: { city_id: "9" } }, r);
    expect(settings.getCitySettings).toHaveBeenCalledWith(3, { fresh: true });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: wire });
  });

  it("a superadmin reads the city they ask for", async () => {
    const r = res();
    await ctrl.getSettings({ user: { role: "superadmin" }, query: { city_id: "9" } }, r);
    expect(settings.getCitySettings).toHaveBeenCalledWith(9, { fresh: true });
  });

  it("a superadmin without a city_id gets a 400", async () => {
    const r = res();
    await ctrl.getSettings({ user: { role: "superadmin" }, query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(settings.getCitySettings).not.toHaveBeenCalled();
  });

  it.each([{ role: "admin", city_id: null }, { role: "executive" }])("a non-superadmin with no city (%j) gets a 403", async (user) => {
    const r = res();
    await ctrl.getSettings({ user, query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(settings.getCitySettings).not.toHaveBeenCalled();
  });
});

describe("saveSettings", () => {
  it("a city admin saves to their own city even if the body names another", async () => {
    const r = res();
    await ctrl.saveSettings({ user: { id: 11, role: "admin", city_id: 3 }, query: {}, body: { city_id: 9, search_system: 2, driver_search_seconds: 90, guarantee_enabled: true } }, r);
    expect(settings.saveCitySettings).toHaveBeenCalledWith({
      cityId: 3,
      input: { searchSystem: 2, searchRadiusKm: undefined, driverSearchSeconds: 90, guaranteeEnabled: true, adminWindowMinutes: undefined, guaranteeReferralsRequired: undefined },
      adminId: 11,
    });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: wire }));
  });

  it("a superadmin saves to the city in the body", async () => {
    const r = res();
    await ctrl.saveSettings({ user: { id: 1, role: "superadmin" }, query: {}, body: { city_id: 9, search_system: 1 } }, r);
    expect(settings.saveCitySettings).toHaveBeenCalledWith(expect.objectContaining({ cityId: 9, adminId: 1 }));
  });

  it("a validation error from the service is returned as its status code", async () => {
    settings.saveCitySettings.mockRejectedValue(Object.assign(new Error("driver_search_seconds must be a whole number between 15 and 600"), { statusCode: 400 }));
    const r = res();
    await ctrl.saveSettings({ user: { id: 1, role: "admin", city_id: 3 }, query: {}, body: { driver_search_seconds: 5 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ success: false, message: "driver_search_seconds must be a whole number between 15 and 600" });
  });
});
