const express = require("express");
const jwt = require("jsonwebtoken");
const http = require("http");

// Mock dependencies before requiring routes
jest.mock("../../whatsapp/client", () => ({
  getBotStatus: jest.fn().mockReturnValue({ status: "connected", connectedPhone: "919999999999" }),
}));
jest.mock("../../services/whatsappTemplateService", () => ({
  getAllTemplates: jest.fn().mockResolvedValue([]),
  saveTemplate: jest.fn(),
  resetTemplate: jest.fn(),
}));
jest.mock("../../services/whatsappChatService", () => ({
  getThreads: jest.fn().mockResolvedValue([
    {
      phone: "919876543210",
      contact_name: "Test Customer",
      user_type: "customer",
      last_message: "Hello",
      is_window_active: true,
      time_remaining_seconds: 7200,
      unread_count: 1,
    },
  ]),
  getMessagesByPhone: jest.fn().mockResolvedValue({
    thread: { phone: "919876543210", contact_name: "Test Customer", is_window_active: true },
    messages: [{ id: 1, body: "Hello", direction: "inbound", status: "delivered" }],
  }),
  sendAdminMessage: jest.fn().mockResolvedValue({
    id: 2,
    body: "Hi there!",
    direction: "outbound",
    status: "sent",
  }),
  processWebhookPayload: jest.fn().mockResolvedValue(true),
}));

const whatsappRoutes = require("../whatsappRoutes");

describe("WhatsApp Chat & Webhook Routes", () => {
  let app;
  let server;
  let port;

  const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-shifter-test-suite";
  const token = jwt.sign({ id: 1, username: "test_staff", role: "admin", city_id: 1 }, JWT_SECRET);

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

  afterAll((done) => {
    server.close(done);
  });

  it("GET /api/v1/whatsapp/chat/threads lists conversation threads", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/whatsapp/chat/threads`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].phone).toBe("919876543210");
  });

  it("GET /api/v1/whatsapp/chat/threads/:phone/messages returns message history", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/whatsapp/chat/threads/919876543210/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.messages[0].body).toBe("Hello");
  });

  it("POST /api/v1/whatsapp/chat/send sends a message", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/whatsapp/chat/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: "919876543210", text: "Hi there!" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.body).toBe("Hi there!");
  });

  it("POST /api/v1/whatsapp/webhook accepts incoming webhook and returns 200", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/whatsapp/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
    });
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toBe("EVENT_RECEIVED");
  });
});
