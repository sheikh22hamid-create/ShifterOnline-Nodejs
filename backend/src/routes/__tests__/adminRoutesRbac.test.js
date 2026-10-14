// Role matrix for the whole admin API: superadmin / admin (city admin) / executive.
// DB is a blanket mock, so a handler may answer 500/200/404 - this only checks the ACCESS decision:
// a role a route does not allow must get the authorize() 403, and an allowed GET must never get it.
// Write routes are never executed for an allowed role (no side effects); only their denials are tested.
process.env.JWT_SECRET = "test-secret";

jest.mock("../../config/db", () => {
  const emptyModel = new Proxy({}, { get: () => jest.fn().mockResolvedValue(null) });
  return new Proxy({}, { get: (_t, prop) => (String(prop).startsWith("$") ? jest.fn().mockResolvedValue([]) : emptyModel) });
});
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const fs = require("fs");
const path = require("path");
const http = require("http");
const jwt = require("jsonwebtoken");

const RIDER_ROLES = ["superadmin", "admin", "executive"];
const ROLES = ["superadmin", "admin", "executive"];
const FORBIDDEN = "Forbidden: insufficient role privileges";

// Writes an executive (support staff) is deliberately allowed to make. A new entry here must be a conscious decision.
const EXECUTIVE_WRITES = [
  "POST /upload-image", "POST /favorite-routes/:id/diagnose", "PUT /auth/profile", "POST /rate-cards/slabs/simulate",
  "POST /riders", "POST /riders/:id/kyc-decision", "POST /orders/scheduled/:id/assign-driver",
  "POST /orders/next-day/suggest-sequence", "POST /orders/next-day/assign-batch", "POST /orders/next-day/:id/offer",
  "POST /orders/:id/assign-rider", "POST /driver-leads/:id/verify", "POST /driver-leads/:id/reject",
  "POST /driver-leads/:id/send-invite", "POST /registration-leads/:id/send-reminder", "POST /registration-leads/:id/status",
  "POST /user-leads/:id/verify", "POST /user-leads/:id/reject",
];

function parseRoutes() {
  const src = fs.readFileSync(path.join(__dirname, "..", "adminRoutes.js"), "utf8");
  const routes = [];
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']\s*,([^;]*?)\);/gs)) {
    const [, method, routePath, rest] = m;
    const a = rest.match(/authorize\(([^)]*)\)/);
    let roles;
    if (a) roles = a[1].includes("RIDER_ROLES") ? RIDER_ROLES : [...a[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1]);
    else roles = /\bauth\b/.test(rest) ? RIDER_ROLES : null; // auth only => any logged-in staff; null => public
    routes.push({ method: method.toUpperCase(), path: routePath, roles });
  }
  return routes;
}

const routes = parseRoutes();
const protectedRoutes = routes.filter((r) => r.roles);

describe("admin route table", () => {
  it("parses the routes and only /auth/login is public", () => {
    expect(routes.length).toBeGreaterThan(200);
    expect(routes.filter((r) => !r.roles).map((r) => `${r.method} ${r.path}`)).toEqual(["POST /auth/login"]);
  });

  it("an executive never gets a write route that is not on the approved list", () => {
    const writes = protectedRoutes
      .filter((r) => r.method !== "GET" && r.roles.includes("executive"))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(writes).toEqual([...EXECUTIVE_WRITES].sort());
  });

  it("platform-wide configuration stays superadmin-only", () => {
    const only = (p, m) => protectedRoutes.find((r) => r.path === p && r.method === m)?.roles;
    for (const [m, p] of [["PUT", "/settings"], ["POST", "/cities"], ["POST", "/categories"], ["POST", "/rate-cards"], ["DELETE", "/riders/:id"], ["DELETE", "/customers/:id"], ["GET", "/wallet-adjustments"]]) {
      expect(only(p, m)).toEqual(["superadmin"]);
    }
  });
});

describe("access decisions over HTTP", () => {
  let server;
  let port;
  const token = (role) => jwt.sign({ id: 1, username: role, role, city_id: role === "superadmin" ? null : 3 }, process.env.JWT_SECRET);
  const call = (method, url, role) => new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: url, method, agent: false, headers: { Authorization: `Bearer ${token(role)}`, "Content-Type": "application/json", Connection: "close" } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", (e) => resolve({ status: 0, body: String(e.message) }));
    req.end("{}");
  });

  beforeAll(async () => {
    const app = require("../../app");
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it("rejects a missing or bad token with 401", async () => {
    const res = await new Promise((resolve) => http.get({ host: "127.0.0.1", port, path: "/api/v1/admin/riders" }, (r) => { r.resume(); resolve(r.statusCode); }));
    expect(res).toBe(401);
  });

  it("every denied role gets 403 and every allowed role's GET is not blocked", async () => {
    const problems = [];
    for (const r of protectedRoutes) {
      if (r.path.includes("export") || r.path.includes("download")) continue;
      const url = `/api/v1/admin${r.path.replace(/:\w+/g, "1")}`;
      for (const role of ROLES) {
        const allowed = r.roles.includes(role);
        if (allowed && r.method !== "GET") continue; // never execute a write handler
        const { status, body } = await call(r.method, url, role);
        const blockedByRole = status === 403 && body.includes(FORBIDDEN);
        if (!allowed && !blockedByRole) problems.push(`${role} should be DENIED ${r.method} ${r.path} (got ${status} ${body.slice(0, 80)})`);
        if (allowed && blockedByRole) problems.push(`${role} should be ALLOWED ${r.method} ${r.path} (got role 403)`);
      }
    }
    expect(problems).toEqual([]);
  }, 120000);
});
