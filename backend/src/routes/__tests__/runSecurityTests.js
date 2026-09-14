require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const http = require("http");
const assert = require("assert");

// Mock Baileys and WhatsApp Client dependencies
const mockClient = {
  mockStatus: "DISCONNECTED",
  mockPhone: null,
  mockQr: null,
  mockPairingCode: null,
  getBotStatus() {
    return {
      status: this.mockStatus,
      connectedPhone: this.mockPhone,
      qrCode: this.mockQr,
      pairingCode: this.mockPairingCode,
    };
  },
  async requestPairingCodeForPhone(phone) {
    this.mockPairingCode = "12345678";
    this.mockStatus = "AWAITING_PAIRING_CODE";
    return "12345678";
  },
  async logoutWhatsAppBot() {
    this.mockStatus = "DISCONNECTED";
    this.mockPhone = null;
    this.mockQr = null;
    this.mockPairingCode = null;
    return true;
  },
  async switchWhatsAppAccount(phone) {
    this.mockStatus = phone ? "AWAITING_PAIRING_CODE" : "AWAITING_QR_SCAN";
    this.mockPhone = null;
    this.mockPairingCode = phone ? "87654321" : null;
    return {
      success: true,
      message: "Switch initiated",
      status: this.mockStatus,
      pairingCode: this.mockPairingCode,
    };
  },
  async initWhatsAppBot() {},
};

// Require module directly
const clientModule = require("../../whatsapp/client");
Object.assign(clientModule, mockClient);

const notificationModule = require("../../whatsapp/notifications");
notificationModule.sendWhatsAppNotification = async (phone, msg) => {
  if (phone === "919999999999") return false;
  return true;
};

const whatsappRoutes = require("../whatsappRoutes");

const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-12345";
process.env.JWT_SECRET = JWT_SECRET;

const app = express();
app.use(express.json());
app.use("/api/v1/whatsapp", whatsappRoutes);

function generateToken(role = "superadmin", username = "superadmin_user", id = 1) {
  return jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: "1h" });
}

async function runAllTests() {
  const superadminToken = generateToken("superadmin", "super_user", 1);
  const adminToken = generateToken("admin", "city_admin", 2);
  const executiveToken = generateToken("executive", "exec_user", 3);

  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

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

  console.log("\n=========================================");
  console.log("🔒 RUNNING WHATSAPP BOT SECURITY TEST SUITE");
  console.log("=========================================\n");

  let passedCount = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  await test("1. Unauthenticated /request-pairing-code is Blocked with 401", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/request-pairing-code", null, { phone: "919876543210" });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.success, false);
  });

  await test("2. Unauthorized (Non-SuperAdmin) /request-pairing-code is Blocked with 403", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/request-pairing-code", adminToken, { phone: "919876543210" });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  await test("3. Authorized Super Admin /request-pairing-code is Allowed with 200", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/request-pairing-code", superadminToken, { phone: "919876543210" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.Result, true);
    assert.strictEqual(res.body.pairingCode, "12345678");
  });

  await test("4. Unauthenticated /send-notification is Blocked with 401", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-notification", null, { phone: "919876543210", message: "Test" });
    assert.strictEqual(res.statusCode, 401);
  });

  await test("5. Unauthorized notification attempt (Executive) is Blocked with 403", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-notification", executiveToken, { phone: "919876543210", message: "Test" });
    assert.strictEqual(res.statusCode, 403);
  });

  await test("6. Authorized notification (Admin/SuperAdmin) is Allowed with 200", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-notification", adminToken, { phone: "919876543210", message: "Alert notification message" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.Result, true);
  });

  await test("7. Unauthenticated /status is Blocked with 401", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/status");
    assert.strictEqual(res.statusCode, 401);
  });

  await test("8. Unauthorized (Non-SuperAdmin) /status is Blocked with 403", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/status", adminToken);
    assert.strictEqual(res.statusCode, 403);
  });

  await test("9. Authorized Super Admin /status is Allowed with 200", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/status", superadminToken);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.Result, true);
    assert.ok(res.body.data.status);
  });

  await test("10. /status response contains no private session keys or authentication secrets", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/status", superadminToken);
    assert.strictEqual(res.body.data.auth, undefined);
    assert.strictEqual(res.body.data.creds, undefined);
    assert.strictEqual(res.body.data.keys, undefined);
  });

  await test("11. Unauthorized user account switch attempt is Blocked with 403", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/switch-account", adminToken, { phone: "919876543210" });
    assert.strictEqual(res.statusCode, 403);
  });

  await test("12. Authorized Super Admin account switch is Allowed with 200", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/switch-account", superadminToken, { phone: "919876543210" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.Result, true);
    assert.strictEqual(res.body.data.pairingCode, "87654321");
  });

  await test("13. Unauthorized logout attempt is Blocked with 403", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/logout", adminToken);
    assert.strictEqual(res.statusCode, 403);
  });

  await test("14. Authorized Super Admin logout is Allowed with 200", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/logout", superadminToken);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.Result, true);
  });

  await test("15. Post-logout state verify: session status set to DISCONNECTED", async () => {
    await makeRequest("POST", "/api/v1/whatsapp/logout", superadminToken);
    const statusRes = await makeRequest("GET", "/api/v1/whatsapp/status", superadminToken);
    assert.strictEqual(statusRes.body.data.status, "DISCONNECTED");
  });

  await test("16. Account switch invalidates old account session", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/switch-account", superadminToken, { phone: "919111111111" });
    assert.strictEqual(res.body.data.status, "AWAITING_PAIRING_CODE");
  });

  await test("17. Pairing code validation: returns 400 for malformed/short phone number", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/request-pairing-code", superadminToken, { phone: "123" });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
  });

  await test("18. Robust error handling: invalid notification body yields proper 400 JSON", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-notification", superadminToken, { phone: "invalid", message: "" });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
  });

  await test("19. Public /calculate-fare REST helper allows rate-limited requests with valid body", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/calculate-fare", null, { pickup: "Indore", drop: "Bhopal", vehicle: "Bike" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.Result, true);
  });

  server.close();
  console.log(`\n=========================================`);
  console.log(`🎉 SECURITY TEST RESULTS: ${passedCount} / 19 PASSED`);
  console.log(`=========================================\n`);
}

runAllTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
