const chatService = require("../whatsappChatService");
const prisma = require("../../config/db");
const cloudApi = require("../../whatsapp/cloudApiClient");

jest.mock("../../config/db", () => ({
  $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  $queryRawUnsafe: jest.fn(),
  tbl_rider: { findFirst: jest.fn() },
  tbl_user: { findFirst: jest.fn() },
}));

jest.mock("../../whatsapp/cloudApiClient", () => ({
  sendTextMessage: jest.fn().mockResolvedValue({ messages: [{ id: "wamid.out123" }] }),
  sendMediaMessage: jest.fn().mockResolvedValue({ messages: [{ id: "wamid.media123" }] }),
  sendTemplateMessage: jest.fn().mockResolvedValue({ messages: [{ id: "wamid.tpl123" }] }),
  fetchAndStoreMedia: jest.fn().mockResolvedValue({
    url: "https://res.cloudinary.com/test/image/upload/v1/whatsapp_inbound/test.jpg",
    mimeType: "image/jpeg",
    relativePath: "images/whatsapp_inbound/test.jpg",
  }),
}));

describe("whatsappChatService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("normalizePhone", () => {
    it("converts 10 digits to 91+10 digits", () => {
      expect(chatService.normalizePhone("9876543210")).toBe("919876543210");
    });

    it("keeps already formatted international digits without plus", () => {
      expect(chatService.normalizePhone("+919876543210")).toBe("919876543210");
    });
  });

  describe("is24HourWindowActive", () => {
    it("returns true if inbound message was received 2 hours ago", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
      expect(chatService.is24HourWindowActive(twoHoursAgo)).toBe(true);
    });

    it("returns false if inbound message was received 25 hours ago", () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3600 * 1000);
      expect(chatService.is24HourWindowActive(twentyFiveHoursAgo)).toBe(false);
    });

    it("returns false if lastInboundAt is null", () => {
      expect(chatService.is24HourWindowActive(null)).toBe(false);
    });
  });

  describe("sendAdminMessage", () => {
    it("throws error if window is closed and trying to send free-text message", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ last_inbound_at: new Date(Date.now() - 30 * 3600 * 1000) }]);

      await expect(
        chatService.sendAdminMessage({
          phone: "9876543210",
          text: "Hello how are you",
          isTemplate: false,
        })
      ).rejects.toThrow(/24-Hour customer window is inactive or expired/i);
    });

    it("allows sending free-text message when 24h window is active", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ phone: "919876543210", last_inbound_at: new Date(Date.now() - 2 * 3600 * 1000) }])
        .mockResolvedValueOnce([{ id: 10 }]);

      const msg = await chatService.sendAdminMessage({
        phone: "9876543210",
        text: "Sure, pickup will arrive shortly!",
        isTemplate: false,
        adminUser: { id: 1, name: "Admin" },
      });

      expect(cloudApi.sendTextMessage).toHaveBeenCalledWith("919876543210", "Sure, pickup will arrive shortly!");
      expect(msg.direction).toBe("outbound");
      expect(msg.status).toBe("sent");
    });

    it("allows sending approved template even when 24h window is closed", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ phone: "919876543210", last_inbound_at: null }])
        .mockResolvedValueOnce([{ id: 11 }]);

      const msg = await chatService.sendAdminMessage({
        phone: "9876543210",
        isTemplate: true,
        templateName: "shifter_app_download",
        templateLanguage: "en_US",
        components: [],
        adminUser: { id: 1, name: "Admin" },
      });

      expect(cloudApi.sendTemplateMessage).toHaveBeenCalledWith("919876543210", "shifter_app_download", "en_US", []);
      expect(msg.is_template).toBe(true);
      expect(msg.template_name).toBe("shifter_app_download");
    });
  });

  describe("processWebhookPayload", () => {
    it("handles incoming text message from Meta webhook", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // deduplication check: no duplicate
        .mockResolvedValueOnce([{ id: 99 }]); // inserted row id

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Ramesh Sharma" } }],
                  messages: [
                    {
                      from: "919876543210",
                      id: "wamid.HBg1234",
                      timestamp: "1711111111",
                      type: "text",
                      text: { body: "Bhaiya gadi kab aayegi?" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await chatService.processWebhookPayload(payload);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO whatsapp_chat_messages"),
        "wamid.HBg1234",
        "919876543210",
        expect.any(String),
        "text",
        "Bhaiya gadi kab aayegi?",
        null,
        null,
        expect.any(Date)
      );
    });

    it("handles incoming image message and downloads & stores media", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // deduplication check: no duplicate
        .mockResolvedValueOnce([{ id: 100 }]) // inserted row id
        .mockResolvedValueOnce([]); // thread check: no thread

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Md Akram" } }],
                  messages: [
                    {
                      from: "919550769387",
                      id: "wamid.HBgImg001",
                      timestamp: "1711112222",
                      type: "image",
                      image: {
                        id: "meta_media_12345",
                        mime_type: "image/jpeg",
                        caption: "Bhai location photo dekh lo",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await chatService.processWebhookPayload(payload);

      expect(cloudApi.fetchAndStoreMedia).toHaveBeenCalledWith({
        mediaId: "meta_media_12345",
        mimeType: "image/jpeg",
        messageType: "image",
      });

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO whatsapp_chat_messages"),
        "wamid.HBgImg001",
        "919550769387",
        expect.any(String),
        "image",
        "Bhai location photo dekh lo",
        "https://res.cloudinary.com/test/image/upload/v1/whatsapp_inbound/test.jpg",
        "image/jpeg",
        expect.any(Date)
      );
    });

    it("handles incoming image with no caption and sets preview to 📷 Photo", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // deduplication
        .mockResolvedValueOnce([{ id: 101 }]) // inserted row id
        .mockResolvedValueOnce([]); // thread check

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Md Akram" } }],
                  messages: [
                    {
                      from: "919550769387",
                      id: "wamid.HBgImg002",
                      timestamp: "1711113333",
                      type: "image",
                      image: {
                        id: "meta_media_67890",
                        mime_type: "image/png",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await chatService.processWebhookPayload(payload);

      // Body should be null (not [IMAGE]) because media_url was fetched successfully
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO whatsapp_chat_messages"),
        "wamid.HBgImg002",
        "919550769387",
        expect.any(String),
        "image",
        null,
        "https://res.cloudinary.com/test/image/upload/v1/whatsapp_inbound/test.jpg",
        "image/jpeg",
        expect.any(Date)
      );

      // Thread should have preview 📷 Photo
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO whatsapp_chat_threads"),
        "919550769387",
        expect.any(String),
        expect.any(String),
        null,
        "📷 Photo"
      );
    });
  });
});
