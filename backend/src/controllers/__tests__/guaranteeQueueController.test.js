jest.mock("../../services/guaranteeQueueService", () => ({
  listMyCases: jest.fn(), getCaseDetail: jest.fn(), rejectCandidate: jest.fn(), recordAction: jest.fn(), reassignCase: jest.fn(), setAvailability: jest.fn(), setCapacity: jest.fn(),
}));
jest.mock("../../services/guaranteeQueueReports", () => ({ queueList: jest.fn(), workload: jest.fn(), report: jest.fn() }));
jest.mock("../../services/guaranteeQueueSettings", () => ({ getQueueSettings: jest.fn(), saveQueueSettings: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const svc = require("../../services/guaranteeQueueService");
const reports = require("../../services/guaranteeQueueReports");
const settings = require("../../services/guaranteeQueueSettings");
const ctrl = require("../guaranteeQueueController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const exec = { id: 5, role: "executive", city_id: 3 };
const admin = { id: 2, role: "admin", city_id: 3 };
const sup = { id: 1, role: "superadmin", city_id: null };
beforeEach(() => jest.clearAllMocks());

describe("executive endpoints", () => {
  it("myCases uses the authenticated id, never a client-supplied one", async () => {
    svc.listMyCases.mockResolvedValue({ active: [], recent: [], reassigned: [] });
    const r = res();
    await ctrl.myCases({ user: exec, query: { admin_id: "999" } }, r);
    expect(svc.listMyCases).toHaveBeenCalledWith(5);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { active: [], recent: [], reassigned: [] } });
  });
  it("recordAction passes only the server-derived actor plus whitelisted body fields", async () => {
    svc.recordAction.mockResolvedValue({ id: 1, meaningful: true });
    const r = res();
    await ctrl.recordAction({ user: exec, params: { orderId: "77" }, body: { type: "driver_contacted", result: "agreed", driver_id: 12, admin_id: 999, created_at: "2001-01-01" } }, r);
    expect(svc.recordAction).toHaveBeenCalledWith({ orderId: 77, actor: { id: 5, role: "executive", cityId: 3 }, type: "driver_contacted", result: "agreed", driverId: 12, meta: undefined });
  });
  it("turns a service 404/403/409 into the same status and message", async () => {
    for (const code of [403, 404, 409]) {
      svc.getCaseDetail.mockRejectedValueOnce(Object.assign(new Error("nope"), { statusCode: code }));
      const r = res();
      await ctrl.caseDetail({ user: exec, params: { orderId: "77" } }, r);
      expect(r.status).toHaveBeenCalledWith(code);
      expect(r.json).toHaveBeenCalledWith({ success: false, message: "nope" });
    }
  });
  it("rejects a non-numeric order id with 400 before touching the service", async () => {
    const r = res();
    await ctrl.caseDetail({ user: exec, params: { orderId: "abc" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(svc.getCaseDetail).not.toHaveBeenCalled();
  });
});

describe("supervisor endpoints", () => {
  it("reassign forwards the actor and optional target; a blank target means automatic", async () => {
    svc.reassignCase.mockResolvedValue({ queueState: "assigned", ownerAdminId: 8 });
    const r = res();
    await ctrl.reassign({ user: admin, params: { orderId: "77" }, body: { target_admin_id: "8", reason: "balance" } }, r);
    expect(svc.reassignCase).toHaveBeenCalledWith({ orderId: 77, targetAdminId: 8, actor: { id: 2, role: "admin", cityId: 3 }, reason: "balance" });
    await ctrl.reassign({ user: admin, params: { orderId: "77" }, body: { target_admin_id: null, reason: "auto" } }, res());
    expect(svc.reassignCase.mock.calls[1][0].targetAdminId).toBeNull();
  });
  it("queue/workload/report are scoped to the admin's city and unscoped (or narrowed) for a superadmin", async () => {
    reports.queueList.mockResolvedValue([]); reports.workload.mockResolvedValue([]); reports.report.mockResolvedValue({});
    await ctrl.queue({ user: admin, scopedCityId: 3, query: {} }, res());
    expect(reports.queueList.mock.calls[0][0].cityId).toBe(3);
    await ctrl.workload({ user: sup, scopedCityId: null, query: {} }, res());
    expect(reports.workload.mock.calls[0][0].cityId).toBeNull();
    await ctrl.report({ user: sup, scopedCityId: 4, query: { from: "2026-10-01", to: "2026-10-14" } }, res());
    expect(reports.report.mock.calls[0][0].cityId).toBe(4);
  });
  describe("report range validation", () => {
    const call = async (query) => { const r = res(); await ctrl.report({ user: sup, scopedCityId: 4, query }, r); return r; };
    beforeEach(() => reports.report.mockResolvedValue({}));
    it("rejects from after to with 400 and does not query", async () => {
      const r = await call({ from: "2026-10-14", to: "2026-10-01" });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(reports.report).not.toHaveBeenCalled();
    });
    it("rejects a range longer than 92 days with 400, accepts exactly 92", async () => {
      const r = await call({ from: "2026-01-01", to: "2026-10-01" });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(reports.report).not.toHaveBeenCalled();
      await call({ from: "2026-07-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" }); // 92 days
      expect(reports.report).toHaveBeenCalledTimes(1);
    });
    it("a date-only `to` covers the whole day (23:59:59.999 UTC)", async () => {
      await call({ from: "2026-10-01", to: "2026-10-14" });
      expect(reports.report.mock.calls[0][0].to.toISOString()).toBe("2026-10-14T23:59:59.999Z");
    });
    it("keeps the default last-24h window", async () => {
      await call({});
      const { from, to } = reports.report.mock.calls[0][0];
      expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });
  it("a non-superadmin without a resolved city fails closed (403), never 'all cities'", async () => {
    const r = res();
    await ctrl.workload({ user: admin, scopedCityId: NaN, query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(reports.workload).not.toHaveBeenCalled();
  });
  it("saveProfile updates availability and/or capacity through the service with the actor", async () => {
    svc.setAvailability.mockResolvedValue({ handedOver: 2 }); svc.setCapacity.mockResolvedValue({ capacity: 4 });
    const r = res();
    await ctrl.saveProfile({ user: admin, params: { adminId: "9" }, body: { available: false, capacity: 4 } }, r);
    expect(svc.setCapacity).toHaveBeenCalledWith(9, 4, { id: 2, role: "admin", cityId: 3 });
    expect(svc.setAvailability).toHaveBeenCalledWith(9, false, { id: 2, role: "admin", cityId: 3 });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { capacity: 4, available: false, handed_over: 2 } });
  });
});

describe("settings endpoints", () => {
  it("an admin is pinned to their own city; a superadmin must name one", async () => {
    settings.getQueueSettings.mockResolvedValue({ execQueueEnabled: false, execDefaultCapacity: 5, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
    const r = res();
    await ctrl.getSettings({ user: admin, query: { city_id: "99" } }, r);
    expect(settings.getQueueSettings).toHaveBeenCalledWith(3, { fresh: true });
    const r2 = res();
    await ctrl.getSettings({ user: sup, query: {} }, r2);
    expect(r2.status).toHaveBeenCalledWith(400);
  });
  it("saveSettings maps snake_case input, passes the acting admin and returns snake_case", async () => {
    settings.saveQueueSettings.mockResolvedValue({ execQueueEnabled: true, recoverOnDriverCancel: true, execDefaultCapacity: 6, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
    const r = res();
    await ctrl.saveSettings({ user: admin, query: {}, body: { exec_queue_enabled: true, guarantee_recover_on_cancel: true, exec_default_capacity: 6 } }, r);
    expect(settings.saveQueueSettings).toHaveBeenCalledWith({
      cityId: 3, adminId: 2,
      input: { execQueueEnabled: true, recoverOnDriverCancel: true, autoOutsideSearch: undefined, execDefaultCapacity: 6, reminderPct: undefined, escalatePct: undefined, autoReassignIdleMinutes: undefined },
    });
    expect(r.json.mock.calls[0][0].data).toMatchObject({ exec_queue_enabled: true, guarantee_recover_on_cancel: true, exec_default_capacity: 6 });
  });
  it("saveSettings maps exec_auto_outside_search both ways", async () => {
    settings.saveQueueSettings.mockResolvedValue({ execQueueEnabled: true, autoOutsideSearch: true, execDefaultCapacity: 5, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
    const r = res();
    await ctrl.saveSettings({ user: admin, query: {}, body: { exec_auto_outside_search: true } }, r);
    expect(settings.saveQueueSettings.mock.calls.at(-1)[0].input.autoOutsideSearch).toBe(true);
    expect(r.json.mock.calls[0][0].data.exec_auto_outside_search).toBe(true);
  });
});

describe("strict input validation (V1-V6)", () => {
  const call = async (fn, req) => { const r = res(); await fn(req, r); return r; };

  describe("saveProfile.available is parsed strictly", () => {
    beforeEach(() => { svc.setAvailability.mockResolvedValue({ handedOver: 0 }); svc.setCapacity.mockResolvedValue({ capacity: null }); });
    it.each([[true, true], [false, false], ["true", true], ["false", false], [1, true], [0, false], ["1", true], ["0", false]])("accepts %p as %p", async (input, expected) => {
      const r = await call(ctrl.saveProfile, { user: admin, params: { adminId: "9" }, body: { available: input } });
      expect(svc.setAvailability).toHaveBeenCalledWith(9, expected, { id: 2, role: "admin", cityId: 3 });
      expect(r.json.mock.calls[0][0].data.available).toBe(expected);
    });
    it.each([["yes"], ["FALSE"], [2], [-1], [""], [null], [[]], [{}], ["on"]])("rejects %p with 400 and changes nothing", async (input) => {
      const r = await call(ctrl.saveProfile, { user: admin, params: { adminId: "9" }, body: { available: input, capacity: 4 } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(svc.setAvailability).not.toHaveBeenCalled();
      expect(svc.setCapacity).not.toHaveBeenCalled();
    });
  });

  describe("saveProfile.capacity", () => {
    beforeEach(() => { svc.setCapacity.mockResolvedValue({ capacity: null }); });
    it.each([[null], [""]])("%p clears the override (null)", async (input) => {
      await call(ctrl.saveProfile, { user: admin, params: { adminId: "9" }, body: { capacity: input } });
      expect(svc.setCapacity).toHaveBeenCalledWith(9, null, { id: 2, role: "admin", cityId: 3 });
    });
    it.each([[1, 1], [200, 200], ["7", 7]])("accepts %p", async (input, expected) => {
      await call(ctrl.saveProfile, { user: admin, params: { adminId: "9" }, body: { capacity: input } });
      expect(svc.setCapacity).toHaveBeenCalledWith(9, expected, { id: 2, role: "admin", cityId: 3 });
    });
    it.each([[0], [201], [-3], [1.5], ["abc"], ["1e2"], [true], [[]], [{}], [NaN]])("rejects %p with 400", async (input) => {
      const r = await call(ctrl.saveProfile, { user: admin, params: { adminId: "9" }, body: { capacity: input } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(svc.setCapacity).not.toHaveBeenCalled();
    });
  });

  describe("recordAction driver_id", () => {
    beforeEach(() => svc.recordAction.mockResolvedValue({ id: 1 }));
    it.each([[12, 12], ["12", 12]])("accepts %p", async (input, expected) => {
      await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note", driver_id: input } });
      expect(svc.recordAction.mock.calls[0][0].driverId).toBe(expected);
    });
    it.each([[true], [false], ["1e3"], [0], [-4], [1.5], ["abc"], [""], [[]], [{}], [Number.MAX_SAFE_INTEGER + 2], ["99999999999999999999"]])("rejects %p with 400", async (input) => {
      const r = await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note", driver_id: input } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(svc.recordAction).not.toHaveBeenCalled();
    });
    it("treats absent / null driver_id as no driver", async () => {
      await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note", driver_id: null } });
      expect(svc.recordAction.mock.calls[0][0].driverId).toBeUndefined();
    });
  });

  describe("recordAction result / type / meta", () => {
    beforeEach(() => svc.recordAction.mockResolvedValue({ id: 1 }));
    it.each(["agreed", "declined", "no_answer", "unreachable", "assigned", "none_available"])("accepts result %s", async (result) => {
      await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note", result } });
      expect(svc.recordAction.mock.calls[0][0].result).toBe(result);
    });
    it.each([["Agreed"], ["AGREED"], ["maybe"], [1], [true], [[]], [{}]])("rejects result %p with 400", async (result) => {
      const r = await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note", result } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(svc.recordAction).not.toHaveBeenCalled();
    });
    it("allows absent / null result", async () => {
      await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note", result: null } });
      await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note" } });
      expect(svc.recordAction).toHaveBeenCalledTimes(2);
    });
    it.each([[5], [true], [null], [["note"]], [{}]])("rejects non-string type %p with 400", async (type) => {
      const r = await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(svc.recordAction).not.toHaveBeenCalled();
    });
    it("passes only note/outcome/reason from a valid meta", async () => {
      await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note", meta: { note: "hi", outcome: 3, reason: "r", admin_id: 99 } } });
      expect(svc.recordAction.mock.calls[0][0].meta).toEqual({ note: "hi", outcome: 3, reason: "r" });
    });
    it.each([[[]], [["a"]], ["str"], [5], [true], [{ note: { a: 1 } }], [{ note: [1] }], [{ note: true }], [{ note: null }], [{ note: "ok", extra: {} }]])("rejects meta %p with 400", async (meta) => {
      const r = await call(ctrl.recordAction, { user: exec, params: { orderId: "7" }, body: { type: "note", meta } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(svc.recordAction).not.toHaveBeenCalled();
    });
  });

  describe("path params", () => {
    it.each([["0"], ["-1"], ["1.5"], ["1e3"], [" "], [""], ["99999999999999999999"], [undefined]])("rejects orderId %p with 400 on recordAction/reassign", async (orderId) => {
      const a = await call(ctrl.recordAction, { user: exec, params: { orderId }, body: { type: "note" } });
      const b = await call(ctrl.reassign, { user: admin, params: { orderId }, body: { reason: "x" } });
      expect(a.status).toHaveBeenCalledWith(400);
      expect(b.status).toHaveBeenCalledWith(400);
      expect(svc.recordAction).not.toHaveBeenCalled();
      expect(svc.reassignCase).not.toHaveBeenCalled();
    });
    it.each([["abc"], ["0"], ["-2"], ["2.5"], ["1e2"]])("rejects adminId %p with 400 on saveProfile", async (adminId) => {
      const r = await call(ctrl.saveProfile, { user: admin, params: { adminId }, body: { capacity: 3 } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(svc.setCapacity).not.toHaveBeenCalled();
    });
    it("rejects a non-integer target_admin_id on reassign", async () => {
      for (const target_admin_id of ["x", 0, -1, 1.5, true, "1e2"]) {
        const r = await call(ctrl.reassign, { user: admin, params: { orderId: "7" }, body: { target_admin_id, reason: "x" } });
        expect(r.status).toHaveBeenCalledWith(400);
      }
      expect(svc.reassignCase).not.toHaveBeenCalled();
    });
  });

  describe("reassign reason", () => {
    it.each([[undefined], [null], [""], ["   "], [5], [true], [["a"]], ["x".repeat(201)]])("rejects reason %p with 400", async (reason) => {
      const r = await call(ctrl.reassign, { user: admin, params: { orderId: "7" }, body: { target_admin_id: 8, reason } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(svc.reassignCase).not.toHaveBeenCalled();
    });
    it("accepts a 200 character reason, trimmed", async () => {
      svc.reassignCase.mockResolvedValue({});
      await call(ctrl.reassign, { user: admin, params: { orderId: "7" }, body: { target_admin_id: 8, reason: ` ${"x".repeat(200)} ` } });
      expect(svc.reassignCase.mock.calls[0][0].reason).toBe("x".repeat(200));
    });
  });

  describe("settings city resolution", () => {
    beforeEach(() => {
      const s = { execQueueEnabled: false, execDefaultCapacity: 5, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null };
      settings.getQueueSettings.mockResolvedValue(s); settings.saveQueueSettings.mockResolvedValue(s);
    });
    it("superadmin names the city via query on GET", async () => {
      await call(ctrl.getSettings, { method: "GET", user: sup, query: { city_id: "4" } });
      expect(settings.getQueueSettings).toHaveBeenCalledWith(4, { fresh: true });
    });
    it.each([["abc"], ["0"], ["-1"], ["1.5"], [""]])("superadmin city_id %p => 400", async (city_id) => {
      const r = await call(ctrl.getSettings, { method: "GET", user: sup, query: { city_id } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(settings.getQueueSettings).not.toHaveBeenCalled();
    });
    it("superadmin PUT without city_id => 400, nothing saved", async () => {
      const r = await call(ctrl.saveSettings, { method: "PUT", user: sup, query: {}, body: { exec_queue_enabled: true } });
      expect(r.status).toHaveBeenCalledWith(400);
      expect(settings.saveQueueSettings).not.toHaveBeenCalled();
    });
    it("admin city comes only from the account, never from body or query", async () => {
      await call(ctrl.saveSettings, { method: "PUT", user: admin, query: { city_id: "99" }, body: { city_id: 99, exec_queue_enabled: true } });
      expect(settings.saveQueueSettings.mock.calls[0][0].cityId).toBe(3);
      await call(ctrl.getSettings, { method: "GET", user: admin, query: { city_id: "99" } });
      expect(settings.getQueueSettings).toHaveBeenCalledWith(3, { fresh: true });
    });
    it("an admin with no city fails closed (403)", async () => {
      const r = await call(ctrl.getSettings, { method: "GET", user: { id: 2, role: "admin", city_id: null }, query: { city_id: "3" } });
      expect(r.status).toHaveBeenCalledWith(403);
      expect(settings.getQueueSettings).not.toHaveBeenCalled();
    });
  });
});

describe("rejectCandidate endpoint", () => {
  it("passes the server-derived actor, the order id and a trimmed reason", async () => {
    svc.rejectCandidate.mockResolvedValue({ released: true });
    const r = res();
    await ctrl.rejectCandidate({ user: exec, params: { orderId: "77" }, body: { reason: "  driver looks unsuitable " } }, r);
    expect(svc.rejectCandidate).toHaveBeenCalledWith({ orderId: 77, actor: { id: 5, role: "executive", cityId: 3 }, reason: "driver looks unsuitable" });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { released: true } });
  });
  it("the reason is optional", async () => {
    svc.rejectCandidate.mockResolvedValue({ released: true });
    await ctrl.rejectCandidate({ user: exec, params: { orderId: "77" }, body: {} }, res());
    expect(svc.rejectCandidate.mock.calls[0][0].reason).toBeUndefined();
  });
  it("400 for a bad order id or a reason over 200 characters, without touching the service", async () => {
    const r1 = res();
    await ctrl.rejectCandidate({ user: exec, params: { orderId: "abc" }, body: {} }, r1);
    expect(r1.status).toHaveBeenCalledWith(400);
    const r2 = res();
    await ctrl.rejectCandidate({ user: exec, params: { orderId: "77" }, body: { reason: "x".repeat(201) } }, r2);
    expect(r2.status).toHaveBeenCalledWith(400);
    expect(svc.rejectCandidate).not.toHaveBeenCalled();
  });
  it("turns a service 403/404/409 into the same status", async () => {
    for (const code of [403, 404, 409]) {
      svc.rejectCandidate.mockRejectedValueOnce(Object.assign(new Error("nope"), { statusCode: code }));
      const r = res();
      await ctrl.rejectCandidate({ user: exec, params: { orderId: "77" }, body: {} }, r);
      expect(r.status).toHaveBeenCalledWith(code);
    }
  });
});
