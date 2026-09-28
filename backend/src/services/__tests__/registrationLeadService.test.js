jest.mock("../../config/db", () => ({
  tbl_registration_lead: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock("../../whatsapp/notifications", () => ({
  sendWhatsAppNotification: jest.fn(),
}));

const prisma = require("../../config/db");
const { sendWhatsAppNotification } = require("../../whatsapp/notifications");
const registrationLeadService = require("../registrationLeadService");

const originalFetch = global.fetch;

describe("registrationLeadService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("upsertOnOtpVerify", () => {
    it("creates a new lead and sends the first reminder when phone is unseen", async () => {
      prisma.tbl_registration_lead.findUnique
        .mockResolvedValueOnce(null) // existing lookup
        .mockResolvedValueOnce({ id: 1, phone: "9990001111" }); // sendReminder's lookup
      prisma.tbl_registration_lead.create.mockResolvedValue({ id: 1, phone: "9990001111" });
      prisma.tbl_registration_lead.update.mockResolvedValue({});
      sendWhatsAppNotification.mockResolvedValue(true);

      await registrationLeadService.upsertOnOtpVerify({ phone: "9990001111", deviceId: "dev-1" });

      expect(prisma.tbl_registration_lead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ phone: "9990001111", device_id: "dev-1", status: "pending" }),
      });
      expect(sendWhatsAppNotification).toHaveBeenCalled();
    });

    it("updates otp_verified_at instead of creating a duplicate when phone already tracked", async () => {
      prisma.tbl_registration_lead.findUnique.mockResolvedValue({ id: 5, phone: "9990002222", device_id: "old" });
      prisma.tbl_registration_lead.update.mockResolvedValue({});

      await registrationLeadService.upsertOnOtpVerify({ phone: "9990002222", deviceId: "new-dev" });

      expect(prisma.tbl_registration_lead.create).not.toHaveBeenCalled();
      expect(prisma.tbl_registration_lead.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({ device_id: "new-dev" }),
      });
      expect(sendWhatsAppNotification).not.toHaveBeenCalled();
    });
  });

  describe("markRegistered", () => {
    it("marks the matching lead as registered and links the rider id", async () => {
      prisma.tbl_registration_lead.findUnique.mockResolvedValue({ id: 9, phone: "9990003333" });
      prisma.tbl_registration_lead.update.mockResolvedValue({ id: 9, status: "registered" });

      await registrationLeadService.markRegistered({ phone: "9990003333", riderId: 42 });

      expect(prisma.tbl_registration_lead.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: expect.objectContaining({ status: "registered", registered_rider_id: 42 }),
      });
    });

    it("no-ops when there is no lead for that phone", async () => {
      prisma.tbl_registration_lead.findUnique.mockResolvedValue(null);

      const result = await registrationLeadService.markRegistered({ phone: "9990004444", riderId: 1 });

      expect(result).toBeNull();
      expect(prisma.tbl_registration_lead.update).not.toHaveBeenCalled();
    });
  });

  describe("sendReminder", () => {
    it("throws when lead is not found", async () => {
      prisma.tbl_registration_lead.findUnique.mockResolvedValue(null);
      await expect(registrationLeadService.sendReminder(123)).rejects.toThrow("Lead not found");
    });

    it("increments reminder_count and records last_reminder_sent_at", async () => {
      prisma.tbl_registration_lead.findUnique.mockResolvedValue({ id: 3, phone: "9990005555" });
      sendWhatsAppNotification.mockResolvedValue(true);
      prisma.tbl_registration_lead.update.mockResolvedValue({});

      await registrationLeadService.sendReminder(3);

      expect(prisma.tbl_registration_lead.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: expect.objectContaining({ reminder_count: { increment: 1 } }),
      });
    });
  });
});
