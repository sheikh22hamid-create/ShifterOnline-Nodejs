const express = require("express");
const jwt = require("jsonwebtoken");
const http = require("http");

// Mock dependencies before requiring routes
jest.mock("../../whatsapp/client", () => ({
  getBotStatus: jest.fn().mockReturnValue({ status: "connected", connectedPhone: "919999999999" }),
}));
jest.mock("../../config/db", () => ({
  tbl_user: {
    findMany: jest.fn().mockResolvedValue([
      { id: 1, name: "Customer One", mobile: 9876543210, city_id: 1, status: 1 },
    ]),
  },
  tbl_rider: {
    findMany: jest.fn().mockResolvedValue([
      {
        id: 1,
        full_name: "Driver One",
        fmobile: "9123456789",
        city_id: 1,
        status: 1,
        a_status: 1,
        verification_status: "approved",
        trial_status: "none",
        vehicle: "Tata Ace",
        vehicle_no: "MP09AB1234",
      },
      {
        id: 2,
        full_name: "Driver Incomplete",
        fmobile: "9123456780",
        city_id: 1,
        status: 1,
        a_status: 0,
        verification_status: "pending",
        trial_status: "none",
        vehicle: "Pickup",
        vehicle_no: null,
      },
      {
        id: 3,
        full_name: "Driver Trial",
        fmobile: "9123456781",
        city_id: 1,
        status: 1,
        a_status: 1,
        verification_status: "approved",
        trial_status: "active",
        vehicle: "3 Wheeler",
        vehicle_no: "MP09CD5678",
      },
    ]),
  },
  tbl_registration_lead: {
    findMany: jest.fn().mockResolvedValue([
      { id: 10, phone: "9811111111", status: "pending" },
    ]),
  },
  tbl_city: {
    findMany: jest.fn().mockResolvedValue([
      { id: 1, title: "Indore" },
      { id: 2, title: "Ujjain" },
    ]),
  },
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

  it("GET /api/v1/whatsapp/chat/audience returns categorized audience lists", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/whatsapp/chat/audience?type=drivers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.counts.drivers_all).toBeGreaterThan(0);
    expect(body.counts.drivers_incomplete).toBeGreaterThan(0);
    expect(body.counts.drivers_complete).toBeGreaterThan(0);
    expect(body.counts.drivers_trial).toBeGreaterThan(0);
  });

  it("POST /api/v1/whatsapp/chat/send-bulk sends message to multiple recipients", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/whatsapp/chat/send-bulk`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipients: [
          { phone: "919876543210", name: "User 1" },
          { phone: "919876543211", name: "User 2" },
        ],
        text: "Bulk announcement test",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(2);
    expect(body.data.sent).toBe(2);
    expect(body.data.failed).toBe(0);
  });
});
