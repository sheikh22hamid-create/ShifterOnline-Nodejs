const { processMenuMessage, STEPS, TEXTS, HELPLINE_NUMBER } = require("../botMenuEngine");
const sessionManager = require("../sessionManager");

// Mock customerHandler for order tracking tests
jest.mock("../handlers/customerHandler", () => ({
  handleTrackingQuery: jest.fn(async (orderId, phone) => {
    return `📦 Tracking info for Order #${orderId}`;
  }),
}));

describe("WhatsApp Bounded Bot Menu Engine", () => {
  const testPhone = "919999888877";

  beforeEach(() => {
    sessionManager.clearSession(testPhone, true);
  });

  test("1. Initial greeting or message shows Language Selection menu", async () => {
    const reply = await processMenuMessage(testPhone, "Hello");
    expect(reply).toContain("Welcome to Shifter Online!");
    expect(reply).toContain("1️⃣ हिंदी (Hindi)");
    expect(reply).toContain("2️⃣ English");
    expect(reply).toContain("3️⃣ Hinglish");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_LANGUAGE);
  });

  test("2. Invalid language input returns invalid language prompt", async () => {
    await processMenuMessage(testPhone, "Hi");
    const reply = await processMenuMessage(testPhone, "random text");
    expect(reply).toContain("कृपया केवल *1*, *2* या *3* लिखकर भेजें");
    expect(reply).toContain(HELPLINE_NUMBER);

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_LANGUAGE);
  });

  test("3. Selecting Language 1 (Hindi) transitions to Role menu in Hindi", async () => {
    await processMenuMessage(testPhone, "Hi");
    const reply = await processMenuMessage(testPhone, "1");

    expect(reply).toContain("आप Shifter Online से किस रूप में जुड़ना चाहते हैं?");
    expect(reply).toContain("1️⃣ Customer");
    expect(reply).toContain("2️⃣ Driver Partner");
    expect(reply).toContain("3️⃣ Job Seeker");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_ROLE);
    expect(session.data.lang).toBe("hi");
  });

  test("4. Selecting Language 2 (English) transitions to Role menu in English", async () => {
    await processMenuMessage(testPhone, "Hi");
    const reply = await processMenuMessage(testPhone, "2");

    expect(reply).toContain("How would you like to connect with Shifter Online?");
    expect(reply).toContain("1️⃣ Customer");
    expect(reply).toContain("2️⃣ Driver Partner");
    expect(reply).toContain("3️⃣ Job Seeker");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_ROLE);
    expect(session.data.lang).toBe("en");
  });

  test("5. Selecting Role 1 (Customer) transitions to Customer menu", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "1"); // Hindi
    const reply = await processMenuMessage(testPhone, "1"); // Customer

    expect(reply).toContain("ग्राहक सेवा (Customer Support)");
    expect(reply).toContain("1️⃣ गाड़ी बुक करें");
    expect(reply).toContain("2️⃣ चालू ऑर्डर ट्रैक करें");
    expect(reply).toContain("3️⃣ गाड़ियों के रेट");
    expect(reply).toContain("4️⃣ कस्टमर केयर");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.IN_MENU);
    expect(session.data.role).toBe("CUSTOMER");
  });

  test("6. Customer selecting 1 gets Customer App download link", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "1"); // Hindi
    await processMenuMessage(testPhone, "1"); // Customer
    const reply = await processMenuMessage(testPhone, "1"); // App Link

    expect(reply).toContain("Customer App डाउनलोड लिंक");
    expect(reply).toContain("https://play.google.com/store/apps/details?id=com.shifter.online");
    expect(reply).toContain(HELPLINE_NUMBER);
  });

  test("7. Customer selecting 4 gets Customer Care helpline details", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "2"); // English
    await processMenuMessage(testPhone, "1"); // Customer
    const reply = await processMenuMessage(testPhone, "4"); // Customer care

    expect(reply).toContain("Customer Care Support");
    expect(reply).toContain(HELPLINE_NUMBER);
    expect(reply).toContain("support@shifteronline.com");
  });

  test("8. Driver Partner selects 1 gets Driver App download link & info", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "3"); // Hinglish
    await processMenuMessage(testPhone, "2"); // Driver Partner
    const reply = await processMenuMessage(testPhone, "1"); // Driver App Link

    expect(reply).toContain("Driver Partner App Download Link");
    expect(reply).toContain("https://play.google.com/store/apps/details?id=com.shifter.driver");
    expect(reply).toContain(HELPLINE_NUMBER);
  });

  test("9. Driver Partner selects 2 gets Required Documents list", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "1"); // Hindi
    await processMenuMessage(testPhone, "2"); // Driver Partner
    const reply = await processMenuMessage(testPhone, "2"); // Documents

    expect(reply).toContain("ड्राइवर ऑनबोर्डिंग के लिए जरूरी कागजात");
    expect(reply).toContain("ड्राइविंग लाइसेंस");
    expect(reply).toContain("वाहन आरसी");
    expect(reply).toContain("आधार कार्ड");
    expect(reply).toContain("पैन कार्ड");
  });

  test("10. Job Seeker selects 1 gets Open Positions & 2 gets How to Apply", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "1"); // Hindi
    await processMenuMessage(testPhone, "3"); // Job Seeker

    const openingsReply = await processMenuMessage(testPhone, "1");
    expect(openingsReply).toContain("वर्तमान रिक्तियां");
    expect(openingsReply).toContain("Customer Support");
    expect(openingsReply).toContain("careers@shifteronline.com");

    const applyReply = await processMenuMessage(testPhone, "2");
    expect(applyReply).toContain("नौकरी के लिए आवेदन कैसे करें");
    expect(applyReply).toContain("careers@shifteronline.com");
  });

  test("11. STRICT GUARDRAIL: Free-form or random chat is blocked and returns helpline 9109114515", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "1"); // Hindi
    await processMenuMessage(testPhone, "1"); // Customer

    // User types random conversational question
    const reply = await processMenuMessage(testPhone, "bhai mera parcel kahan tak pahucha kitna time lagega?");

    expect(reply).toContain("क्षमा करें, मैं आपका संदेश समझ नहीं पाया");
    expect(reply).toContain("मैं एक स्वचालित मेनू बॉट हूँ");
    expect(reply).toContain(HELPLINE_NUMBER);
    expect(reply).toContain("कस्टमर केयर");
    expect(reply).toContain("ग्राहक सेवा (Customer Support)"); // Shows menu options again
  });

  test("12. Entering '0' or 'menu' at any point resets back to Language Selection", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "1"); // Hindi
    await processMenuMessage(testPhone, "2"); // Driver

    const reply = await processMenuMessage(testPhone, "0");
    expect(reply).toContain("Welcome to Shifter Online!");
    expect(reply).toContain("1️⃣ हिंदी (Hindi)");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_LANGUAGE);
  });
});
