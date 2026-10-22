process.env.JWT_SECRET = "test-secret";

jest.mock("../../config/db", () => ({ admin: { findUnique: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const prisma = require("../../config/db");
const auth = require("../../middleware/auth");
const {
  EXECUTIVE_MODULES,
  parseSidebarModules,
  serializeSidebarModules,
  normalizeSidebarModules,
  modulesForApiPath,
  isApiPathAllowed,
  canSearchSection,
} = require("../executiveModules");

const REPO = path.join(__dirname, "..", "..", "..", "..");

describe("module catalogue", () => {
  it("matches every sidebar tab an executive can see in navigation.js", () => {
    const nav = fs.readFileSync(path.join(REPO, "frontend", "src", "config", "navigation.js"), "utf8");
    const keys = [];
    for (const m of nav.matchAll(/\{\s*to:\s*'([^']+)'[^}]*?roles:\s*(ALL_STAFF|\[[^\]]*\])/g)) {
      if (m[2] === "ALL_STAFF" || m[2].includes("executive")) keys.push(m[1]);
    }
    expect([...new Set(keys)].sort()).toEqual([...EXECUTIVE_MODULES].sort());
  });

  it("has an API rule for every route an executive can reach", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "routes", "adminRoutes.js"), "utf8");
    const uncovered = [];
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']\s*,([^;]*?)\);/gs)) {
      const [, method, routePath, rest] = m;
      const a = rest.match(/authorize\(([^)]*)\)/);
      const roles = a ? (a[1].includes("RIDER_ROLES") ? ["executive"] : [...a[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1])) : ["executive"];
      if (!roles.includes("executive") || routePath.startsWith("/auth/")) continue;
      if (!modulesForApiPath(routePath)) uncovered.push(`${method.toUpperCase()} ${routePath}`);
    }
    expect(uncovered).toEqual([]);
  });
});

describe("permissions encoding", () => {
  it("treats empty, legacy or malformed values as unrestricted", () => {
    expect(parseSidebarModules(null)).toBeNull();
    expect(parseSidebarModules("")).toBeNull();
    expect(parseSidebarModules("not json")).toBeNull();
    expect(parseSidebarModules('["orders.read"]')).toBeNull();
    expect(parseSidebarModules('{"other":1}')).toBeNull();
  });

  it("round-trips a list, including the empty list (= nothing visible)", () => {
    expect(parseSidebarModules(serializeSidebarModules(["/orders", "/drivers"]))).toEqual(["/orders", "/drivers"]);
    expect(parseSidebarModules(serializeSidebarModules([]))).toEqual([]);
    expect(serializeSidebarModules(null)).toBeNull();
  });

  it("drops module keys that no longer exist", () => {
    expect(parseSidebarModules('{"sidebar_modules":["/orders","/gone"]}')).toEqual(["/orders"]);
  });

  it("rejects unknown or non-array input and de-duplicates", () => {
    expect(normalizeSidebarModules(["/orders", "/orders"])).toEqual({ ok: true, modules: ["/orders"] });
    expect(normalizeSidebarModules(null)).toEqual({ ok: true, modules: null });
    expect(normalizeSidebarModules("/orders").ok).toBe(false);
    expect(normalizeSidebarModules(["/settings"]).ok).toBe(false);
  });
});

describe("API path rules", () => {
  it("allows an endpoint only through a module that uses it", () => {
    expect(isApiPathAllowed("/customers", ["/customers"])).toBe(true);
    expect(isApiPathAllowed("/customers/12/wallet-history", ["/customers"])).toBe(true);
    expect(isApiPathAllowed("/customers", ["/orders"])).toBe(false);
    expect(isApiPathAllowed("/riders/5", ["/customers"])).toBe(false);
  });

  it("picks the most specific prefix", () => {
    expect(isApiPathAllowed("/orders/scheduled", ["/orders"])).toBe(false);
    expect(isApiPathAllowed("/orders/scheduled", ["/orders/scheduled"])).toBe(true);
    expect(isApiPathAllowed("/orders/77", ["/orders/scheduled"])).toBe(true); // shared order-detail drawer
    expect(isApiPathAllowed("/orders/77", ["/customers"])).toBe(false);
    expect(isApiPathAllowed("/booking-guarantee/exec/my-cases", ["/guarantee/my-cases"])).toBe(true);
    expect(isApiPathAllowed("/booking-guarantee/cases", ["/guarantee/my-cases"])).toBe(false);
  });

  it("lets shared lookups through for any enabled module but not for an empty list", () => {
    expect(isApiPathAllowed("/cities", ["/customers"])).toBe(true);
    expect(isApiPathAllowed("/cities", [])).toBe(false);
  });

  it("fails closed for paths no rule covers, and ignores a query string / lookalike prefix", () => {
    expect(isApiPathAllowed("/something-new", ["/orders"])).toBe(false);
    expect(isApiPathAllowed("/customers?search=a", ["/customers"])).toBe(true);
    expect(isApiPathAllowed("/customersx", ["/customers"])).toBe(false);
  });

  it("filters global-search sections by module", () => {
    expect(canSearchSection(null, "orders")).toBe(true);
    expect(canSearchSection(["/customers"], "customers")).toBe(true);
    expect(canSearchSection(["/customers"], "orders")).toBe(false);
    expect(canSearchSection(["/drivers"], "drivers")).toBe(true);
  });
});

describe("auth middleware for executives", () => {
  const tokenFor = (role) => jwt.sign({ id: 9, username: "e", role, city_id: 1 }, process.env.JWT_SECRET);
  const run = async (role, urlPath, isAdminPanelApi = true) => {
    const req = { headers: { authorization: `Bearer ${tokenFor(role)}` }, isAdminPanelApi, path: urlPath };
    const res = { statusCode: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = jest.fn();
    await auth(req, res, next);
    return { req, res, next };
  };

  beforeEach(() => prisma.admin.findUnique.mockReset());

  it("leaves an unrestricted executive exactly as before", async () => {
    prisma.admin.findUnique.mockResolvedValue({ permissions: null });
    const { next, req } = await run("executive", "/customers");
    expect(next).toHaveBeenCalled();
    expect(req.executiveModules).toBeNull();
  });

  it("does not block when the account row is missing (previous behaviour)", async () => {
    prisma.admin.findUnique.mockResolvedValue(null);
    expect((await run("executive", "/customers")).next).toHaveBeenCalled();
  });

  it("blocks a module the admin did not enable and allows one they did", async () => {
    prisma.admin.findUnique.mockResolvedValue({ permissions: serializeSidebarModules(["/orders"]) });
    const blocked = await run("executive", "/customers");
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.next).not.toHaveBeenCalled();
    const ok = await run("executive", "/orders/12");
    expect(ok.next).toHaveBeenCalled();
    expect(ok.req.executiveModules).toEqual(["/orders"]);
  });

  it("cannot be dodged with a differently-cased or slash-padded path", async () => {
    prisma.admin.findUnique.mockResolvedValue({ permissions: serializeSidebarModules(["/orders"]) });
    for (const p of ["/Customers", "/CUSTOMERS/1", "//customers", "/customers/"]) {
      const r = await run("executive", p);
      expect(r.res.statusCode).toBe(403);
      expect(r.next).not.toHaveBeenCalled();
    }
    expect((await run("executive", "/Orders/5")).next).toHaveBeenCalled();
  });

  it("always lets a restricted executive load their own profile", async () => {
    prisma.admin.findUnique.mockResolvedValue({ permissions: serializeSidebarModules([]) });
    expect((await run("executive", "/auth/me")).next).toHaveBeenCalled();
  });

  it("fails closed when the permission lookup errors", async () => {
    prisma.admin.findUnique.mockRejectedValue(new Error("db down"));
    const { res, next } = await run("executive", "/orders");
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("never touches the DB for admins, or for non-admin-panel mounts", async () => {
    expect((await run("admin", "/customers")).next).toHaveBeenCalled();
    expect((await run("superadmin", "/customers")).next).toHaveBeenCalled();
    expect((await run("executive", "/pair", false)).next).toHaveBeenCalled();
    expect(prisma.admin.findUnique).not.toHaveBeenCalled();
  });
});
