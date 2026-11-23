const express = require("express");
const jwt = require("jsonwebtoken");
const http = require("http");

// Mock dependencies
jest.mock("../../whatsapp/client", () => ({
  getBotStatus: jest.fn(() => ({
    status: "CONNECTED",
    connectedPhone: "919876543210",
  })),
}));

jest.mock("../../whatsapp/notifications", () => ({
  sendWhatsAppNotification: jest.fn(async (phone, msg, options) => {
    if (phone === "919999999999") return false;
    return true;
  }),
}));

const prisma = require("../../config/db");
const whatsappRoutes = require("../whatsappRoutes");

describe("WhatsApp Broadcast Permanent Templates & Media Attachments API", () => {
  let app;
  let server;
  let port;

  const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-shifter-test-suite";
  const superAdminToken = jwt.sign({ id: 1, username: "super_user", role: "superadmin" }, JWT_SECRET);
  const adminToken = jwt.sign({ id: 2, username: "city_admin", role: "admin" }, JWT_SECRET);
  const execToken = jwt.sign({ id: 3, username: "ops_exec", role: "executive" }, JWT_SECRET);

  beforeAll((done) => {
    app = express();
    app.use(express.json());
    app.use("/api/v1/whatsapp", whatsappRoutes);

    server = http.createServer(app);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll(async () => {
    await prisma.app_settings.deleteMany({
      where: { setting_key: "whatsapp_broadcast_templates" },
    });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.app_settings.deleteMany({
      where: { setting_key: "whatsapp_broadcast_templates" },
    });
  });

  function makeRequest(method, path, token, body = null, contentType = "application/json") {
    return new Promise((resolve, reject) => {
      const payload = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
      const headers = {
        Authorization: `Bearer ${token}`,
      };
      if (payload) {
        headers["Content-Type"] = contentType;
        headers["Content-Length"] = Buffer.byteLength(payload);
      }

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} });
            } catch (e) {
              resolve({ statusCode: res.statusCode, body: data });
            }
          });
        }
      );

      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  test("1. GET /templates returns templates with default & active messages", async () => {
    const res = await makeRequest("GET", "/api/v1/whatsapp/templates", execToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("defaultMessage");
    expect(res.body.data[0]).toHaveProperty("message");
    expect(res.body.data[0]).toHaveProperty("is_customized", false);
  });

  test("2. PUT /templates/:id permanently updates template (Admin & SuperAdmin allowed)", async () => {
    const templateId = "customer_app_download";
    const updatePayload = {
      message: "Permanent new offer: Flat 20% off on all mini-trucks! 🚚",
      media_url: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      media_type: "image",
      media_filename: "sample.jpg",
    };

    const res = await makeRequest("PUT", `/api/v1/whatsapp/templates/${templateId}`, adminToken, updatePayload);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe(updatePayload.message);
    expect(res.body.data.media_url).toBe(updatePayload.media_url);
    expect(res.body.data.is_customized).toBe(true);

    // Verify GET /templates now reflects the saved template permanently
    const getRes = await makeRequest("GET", "/api/v1/whatsapp/templates", execToken);
    const updated = getRes.body.data.find((t) => t.id === templateId);
    expect(updated.message).toBe(updatePayload.message);
    expect(updated.media_url).toBe(updatePayload.media_url);
    expect(updated.is_customized).toBe(true);
  });

  test("3. PUT /templates/:id is Forbidden (403) for Executive", async () => {
    const res = await makeRequest("PUT", "/api/v1/whatsapp/templates/customer_app_download", execToken, {
      message: "Unauthorized edit",
    });
    expect(res.statusCode).toBe(403);
  });

  test("4. POST /templates/:id/reset restores factory default", async () => {
    const templateId = "customer_app_download";
    // First save a custom version
    await makeRequest("PUT", `/api/v1/whatsapp/templates/${templateId}`, superAdminToken, {
      message: "Customized text",
    });

    // Reset it
    const resetRes = await makeRequest("POST", `/api/v1/whatsapp/templates/${templateId}/reset`, superAdminToken);
    expect(resetRes.statusCode).toBe(200);
    expect(resetRes.body.data.is_customized).toBe(false);

    // Verify list
    const getRes = await makeRequest("GET", "/api/v1/whatsapp/templates", execToken);
    const item = getRes.body.data.find((t) => t.id === templateId);
    expect(item.is_customized).toBe(false);
  });

  test("5. POST /send-broadcast handles image attachment + caption", async () => {
    const notifications = require("../../whatsapp/notifications");
    notifications.sendWhatsAppNotification.mockClear();

    const broadcastPayload = {
      recipients: ["9876543210"],
      message: "Special Promo with flyer!",
      campaignName: "Flyer Campaign",
      mediaUrl: "https://res.cloudinary.com/demo/image/upload/promo.jpg",
      mediaType: "image",
    };

    const res = await makeRequest("POST", "/api/v1/whatsapp/send-broadcast", execToken, broadcastPayload);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sent).toBe(1);

    expect(notifications.sendWhatsAppNotification).toHaveBeenCalledWith(
      "919876543210",
      "Special Promo with flyer!",
      {
        mediaUrl: "https://res.cloudinary.com/demo/image/upload/promo.jpg",
        mediaType: "image",
      }
    );
  });

  test("6. POST /send-broadcast allows media-only (empty text) when media is attached", async () => {
    const notifications = require("../../whatsapp/notifications");
    notifications.sendWhatsAppNotification.mockClear();

    const broadcastPayload = {
      recipients: ["9876543210"],
      message: "",
      campaignName: "Media Only Campaign",
      mediaUrl: "https://res.cloudinary.com/demo/image/upload/banner.jpg",
      mediaType: "image",
    };

    const res = await makeRequest("POST", "/api/v1/whatsapp/send-broadcast", execToken, broadcastPayload);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sent).toBe(1);

    expect(notifications.sendWhatsAppNotification).toHaveBeenCalledWith(
      "919876543210",
      "",
      {
        mediaUrl: "https://res.cloudinary.com/demo/image/upload/banner.jpg",
        mediaType: "image",
      }
    );
  });

  test("7. POST /send-broadcast rejects empty text when NO media is attached", async () => {
    const res = await makeRequest("POST", "/api/v1/whatsapp/send-broadcast", execToken, {
      recipients: ["9876543210"],
      message: "",
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.msg).toMatch(/Message text or media attachment is required/);
  });
});
