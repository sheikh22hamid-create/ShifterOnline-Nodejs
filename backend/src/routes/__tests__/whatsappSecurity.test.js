const express = require("express");
const jwt = require("jsonwebtoken");
const http = require("http");

// Mock Baileys and WhatsApp Client dependencies
jest.mock("../../whatsapp/client", () => {
  let mockStatus = "DISCONNECTED";
  let mockPhone = null;
  let mockQr = null;
  let mockPairingCode = null;

  return {
    getBotStatus: jest.fn(() => ({
      status: mockStatus,
      connectedPhone: mockPhone,
      qrCode: mockQr,
      pairingCode: mockPairingCode,
    })),
    requestPairingCodeForPhone: jest.fn(async (phone) => {
      mockPairingCode = "12345678";
      mockStatus = "AWAITING_PAIRING_CODE";
      return "12345678";
    }),
    logoutWhatsAppBot: jest.fn(async () => {
      mockStatus = "DISCONNECTED";
      mockPhone = null;
      mockQr = null;
      mockPairingCode = null;
      return true;
    }),
    switchWhatsAppAccount: jest.fn(async (phone) => {
      mockStatus = phone ? "AWAITING_PAIRING_CODE" : "AWAITING_QR_SCAN";
      mockPhone = null;
      mockPairingCode = phone ? "87654321" : null;
      return {
        success: true,
        message: "Switch initiated",
        status: mockStatus,
        pairingCode: mockPairingCode,
      };
    }),
    initWhatsAppBot: jest.fn(async () => {}),
  };
});

jest.mock("../../whatsapp/notifications", () => ({
  sendWhatsAppNotification: jest.fn(async (phone, msg) => {
    if (phone === "919999999999") return false;
    return true;
  }),
}));

const whatsappRoutes = require("../whatsappRoutes");

const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-12345";
process.env.JWT_SECRET = JWT_SECRET;

const app = express();
app.use(express.json());
app.use("/api/v1/whatsapp", whatsappRoutes);

function generateToken(role = "superadmin", username = "superadmin_user", id = 1) {
  return jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: "1h" });
}

describe("WhatsApp Bot API Security & Super Admin Account Management Test Suite", () => {
  const superadminToken = generateToken("superadmin", "super_user", 1);
  const adminToken = generateToken("admin", "city_admin", 2);
  const executiveToken = generateToken("executive", "exec_user", 3);

  let server;
  let baseUrl;

  beforeAll((done) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    if (server) server.close(done);
    else done();
  });

  async function makeRequest(method, pathUrl, token = null, body = null) {
    const url = `${baseUrl}${pathUrl}`;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    return new Promise((resolve, reject) => {
      const req = http.request(url, { method, headers }, (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ statusCode: response.statusCode, body: parsed });
        });
      });
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  test("1. Unauthenticated /request-pairing-code is Blocked with 401", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/request-pairing-code", null, { phone: "919876543210" });
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("2. Unauthorized (Non-SuperAdmin) /request-pairing-code is Blocked with 403", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/request-pairing-code", adminToken, { phone: "919876543210" });
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test("3. Authorized Super Admin /request-pairing-code is Allowed with 200", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/request-pairing-code", superadminToken, { phone: "919876543210" });
    expect(res.statusCode).toBe(200);
    expect(res.body.Result).toBe(true);
    expect(res.body.pairingCode).toBe("12345678");
  });

  test("4. Unauthenticated /send-notification is Blocked with 401", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-notification", null, { phone: "919876543210", message: "Test" });
    expect(res.statusCode).toBe(401);
  });

  test("5. Unauthorized notification attempt (Executive) is Blocked with 403", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-notification", executiveToken, { phone: "919876543210", message: "Test" });
    expect(res.statusCode).toBe(403);
  });

  test("6. Authorized notification (Admin/SuperAdmin) is Allowed with 200", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-notification", adminToken, { phone: "919876543210", message: "Alert notification message" });
    expect(res.statusCode).toBe(200);
    expect(res.body.Result).toBe(true);
  });

  test("7. Unauthenticated /status is Blocked with 401", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/status");
    expect(res.statusCode).toBe(401);
  });

  test("8. Unauthorized (Non-SuperAdmin) /status is Blocked with 403", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/status", adminToken);
    expect(res.statusCode).toBe(403);
  });

  test("9. Authorized Super Admin /status is Allowed with 200", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/status", superadminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.Result).toBe(true);
    expect(res.body.data.status).toBeDefined();
  });

  test("10. /status response contains no private session keys or authentication secrets", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/status", superadminToken);
    expect(res.body.data.auth).toBeUndefined();
    expect(res.body.data.creds).toBeUndefined();
    expect(res.body.data.keys).toBeUndefined();
  });

  test("11. Unauthorized user account switch attempt is Blocked with 403", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/switch-account", adminToken, { phone: "919876543210" });
    expect(res.statusCode).toBe(403);
  });

  test("12. Authorized Super Admin account switch is Allowed with 200", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/switch-account", superadminToken, { phone: "919876543210" });
    expect(res.statusCode).toBe(200);
    expect(res.body.Result).toBe(true);
    expect(res.body.data.pairingCode).toBe("87654321");
  });

  test("13. Unauthorized logout attempt is Blocked with 403", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/logout", adminToken);
    expect(res.statusCode).toBe(403);
  });

  test("14. Authorized Super Admin logout is Allowed with 200", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/logout", superadminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.Result).toBe(true);
  });

  test("15. Post-logout state verify: session status set to DISCONNECTED", async () => {
    await makeRequest("POST", "/api/v1/whatsapp/logout", superadminToken);
    const statusRes = await makeRequest("GET", "/api/v1/whatsapp/status", superadminToken);
    expect(statusRes.body.data.status).toBe("DISCONNECTED");
  });

  test("16. Account switch invalidates old account session", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/switch-account", superadminToken, { phone: "919111111111" });
    expect(res.body.data.status).toBe("AWAITING_PAIRING_CODE");
  });

  test("17. Pairing code validation: returns 400 for malformed/short phone number", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/request-pairing-code", superadminToken, { phone: "123" });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("18. Robust error handling: invalid notification body yields proper 400 JSON", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-notification", superadminToken, { phone: "invalid", message: "" });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
