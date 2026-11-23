const prisma = require("../../config/db");
const templateService = require("../whatsappTemplateService");
const { WHATSAPP_TEMPLATES } = require("../../whatsapp/templates");

describe("WhatsApp Template Storage & Permanent Editing Service", () => {
  beforeEach(async () => {
    // Clear custom templates in app_settings for test isolation
    await prisma.app_settings.deleteMany({
      where: { setting_key: "whatsapp_broadcast_templates" },
    });
  });

  afterAll(async () => {
    await prisma.app_settings.deleteMany({
      where: { setting_key: "whatsapp_broadcast_templates" },
    });
    await prisma.$disconnect();
  });

  test("1. getAllTemplates returns pre-made templates with defaultMessage when nothing is stored", async () => {
    const list = await templateService.getAllTemplates();
    expect(list.length).toBe(WHATSAPP_TEMPLATES.length);

    const first = list[0];
    expect(first.is_customized).toBe(false);
    expect(first.defaultMessage).toBe(WHATSAPP_TEMPLATES[0].message);
    expect(first.message).toBe(WHATSAPP_TEMPLATES[0].message);
    expect(first.media_url).toBeNull();
  });

  test("2. saveTemplate permanently updates template message and media attachment", async () => {
    const targetId = WHATSAPP_TEMPLATES[0].id;
    const newMessage = "Hello! This is a permanently customized WhatsApp template message. 🚚";
    const mediaUrl = "https://res.cloudinary.com/test/image/upload/sample.jpg";

    const updated = await templateService.saveTemplate(
      targetId,
      {
        message: newMessage,
        media_url: mediaUrl,
        media_type: "image",
        media_filename: "sample.jpg",
      },
      { id: 1, username: "superadmin" }
    );

    expect(updated).toBeDefined();
    expect(updated.id).toBe(targetId);
    expect(updated.message).toBe(newMessage);
    expect(updated.defaultMessage).toBe(WHATSAPP_TEMPLATES[0].message); // Preserved!
    expect(updated.media_url).toBe(mediaUrl);
    expect(updated.media_type).toBe("image");
    expect(updated.media_filename).toBe("sample.jpg");
    expect(updated.is_customized).toBe(true);
    expect(updated.updated_by).toBe("superadmin");

    // Re-fetch all and verify persistence
    const reloadedList = await templateService.getAllTemplates();
    const reloaded = reloadedList.find((t) => t.id === targetId);
    expect(reloaded.message).toBe(newMessage);
    expect(reloaded.media_url).toBe(mediaUrl);
    expect(reloaded.is_customized).toBe(true);

    // Other templates remain untouched
    const second = reloadedList[1];
    expect(second.is_customized).toBe(false);
    expect(second.message).toBe(WHATSAPP_TEMPLATES[1].message);
  });

  test("3. resetTemplate restores template back to factory default", async () => {
    const targetId = WHATSAPP_TEMPLATES[0].id;

    // First save
    await templateService.saveTemplate(
      targetId,
      { message: "Temporary custom message" },
      { id: 1, username: "admin" }
    );

    // Then reset
    const reset = await templateService.resetTemplate(targetId);
    expect(reset.message).toBe(WHATSAPP_TEMPLATES[0].message);
    expect(reset.is_customized).toBe(false);
    expect(reset.media_url).toBeNull();

    // Verify list
    const list = await templateService.getAllTemplates();
    const found = list.find((t) => t.id === targetId);
    expect(found.is_customized).toBe(false);
    expect(found.message).toBe(WHATSAPP_TEMPLATES[0].message);
  });

  test("4. saveTemplate validation: rejects non-existent template ID and empty payload", async () => {
    await expect(
      templateService.saveTemplate("invalid_id", { message: "Test" }, { id: 1 })
    ).rejects.toThrow(/Template not found/);

    await expect(
      templateService.saveTemplate(WHATSAPP_TEMPLATES[0].id, { message: "" }, { id: 1 })
    ).rejects.toThrow(/Message text or media attachment is required/);
  });
});
