const { processMenuMessage, STEPS, TEXTS, HELPLINE_NUMBER } = require("../botMenuEngine");
const sessionManager = require("../sessionManager");

// Mock customerHandler for order tracking tests
jest.mock("../handlers/customerHandler", () => ({
  handleTrackingQuery: jest.fn(async (orderId, phone) => {
    return `📦 Tracking info for Order #${orderId}`;
  }),
}));

describe("WhatsApp Bounded Bot Menu Engine with Regional Languages", () => {
  const testPhone = "919999888877";

  beforeEach(() => {
    sessionManager.clearSession(testPhone, true);
  });

  test("1. Initial greeting or message shows Language Selection menu with Option 4 (Other Indian Languages)", async () => {
    const reply = await processMenuMessage(testPhone, "Hello");
    expect(reply).toContain("Welcome to Shifter Online!");
    expect(reply).toContain("1️⃣ हिंदी (Hindi)");
    expect(reply).toContain("2️⃣ English");
    expect(reply).toContain("3️⃣ Hinglish");
    expect(reply).toContain("4️⃣ Other Indian Languages");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_LANGUAGE);
  });

  test("2. Selecting Option 4 presents Regional Language Menu (Marathi, Gujarati, Punjabi, Bengali, Telugu, Tamil, Kannada)", async () => {
    await processMenuMessage(testPhone, "Hi");
    const reply = await processMenuMessage(testPhone, "4");

    expect(reply).toContain("Select Your Regional Language");
    expect(reply).toContain("1️⃣ मराठी (Marathi)");
    expect(reply).toContain("2️⃣ ગુજરાતી (Gujarati)");
    expect(reply).toContain("3️⃣ ਪੰਜਾਬੀ (Punjabi)");
    expect(reply).toContain("4️⃣ বাংলা (Bengali)");
    expect(reply).toContain("5️⃣ తెలుగు (Telugu)");
    expect(reply).toContain("6️⃣ தமிழ் (Tamil)");
    expect(reply).toContain("7️⃣ ಕನ್ನಡ (Kannada)");
    expect(reply).toContain("0️⃣ Back");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_REGIONAL_LANGUAGE);
  });

  test("3. Regional Language: Selecting 1 (Marathi) switches entire conversation to Marathi", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "4"); // Other Indian Languages
    const roleReply = await processMenuMessage(testPhone, "1"); // Marathi

    expect(roleReply).toContain("आपण Shifter Online शी कोणत्या भूमिकेत जोडू इच्छिता?");
    expect(roleReply).toContain("1️⃣ Customer");
    expect(roleReply).toContain("2️⃣ Driver Partner");
    expect(roleReply).toContain("3️⃣ Job Seeker");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_ROLE);
    expect(session.data.lang).toBe("mr");

    // Select Customer in Marathi
    const customerMenuReply = await processMenuMessage(testPhone, "1");
    expect(customerMenuReply).toContain("ग्राहक सेवा");
    expect(customerMenuReply).toContain("वाहन बुक करा");

    // Select Option 1 (App link) in Marathi
    const appReply = await processMenuMessage(testPhone, "1");
    expect(appReply).toContain("वाहन बुक करण्यासाठी Customer App डाउनलोड करा");
    expect(appReply).toContain("https://play.google.com/store/apps/details?id=com.shifter.online");

    // Test Strict Guardrail in Marathi
    const guardrailReply = await processMenuMessage(testPhone, "kasa ahes bhai?");
    expect(guardrailReply).toContain("माफ करा, मला आपला संदेश समजला नाही");
    expect(guardrailReply).toContain(HELPLINE_NUMBER);
  });

  test("4. Regional Language: Selecting 2 (Gujarati) switches conversation to Gujarati", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "4"); // Other Indian Languages
    const roleReply = await processMenuMessage(testPhone, "2"); // Gujarati

    expect(roleReply).toContain("તમે Shifter Online સાથે કઈ રીતે જોડાવા માંગો છો?");
    expect(roleReply).toContain("1️⃣ Customer");

    const session = sessionManager.getSession(testPhone);
    expect(session.data.lang).toBe("gu");

    // Select Driver Partner in Gujarati
    const driverMenuReply = await processMenuMessage(testPhone, "2");
    expect(driverMenuReply).toContain("ડ્રાઇવર પાર્ટનર સેવા");
    expect(driverMenuReply).toContain("વાહન જોડો");
  });

  test("5. Regional Language: In Regional menu, typing 0 goes back to Primary Language Menu", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "4"); // Regional menu
    const reply = await processMenuMessage(testPhone, "0"); // Back

    expect(reply).toContain("Welcome to Shifter Online!");
    expect(reply).toContain("1️⃣ हिंदी (Hindi)");
    expect(reply).toContain("4️⃣ Other Indian Languages");

    const session = sessionManager.getSession(testPhone);
    expect(session.step).toBe(STEPS.AWAITING_LANGUAGE);
  });

  test("6. Standard Language 1 (Hindi) still works seamlessly", async () => {
    await processMenuMessage(testPhone, "Hi");
    const reply = await processMenuMessage(testPhone, "1"); // Hindi

    expect(reply).toContain("आप Shifter Online से किस रूप में जुड़ना चाहते हैं?");
    expect(reply).toContain("1️⃣ Customer");

    const session = sessionManager.getSession(testPhone);
    expect(session.data.lang).toBe("hi");
  });

  test("7. All outbound messages systematically include STOP hint footer", async () => {
    const reply = await processMenuMessage(testPhone, "Hello");
    expect(reply).toContain("बॉट रोकने के लिए *STOP* लिखें");
    expect(reply).toContain("Type *STOP* to pause");
  });

  test("8. After 3 unrecognized / random messages, bot escalates directly to Customer Care contact", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "1"); // Hindi
    await processMenuMessage(testPhone, "1"); // Customer

    // Random attempt 1
    const reply1 = await processMenuMessage(testPhone, "bhai koi sun raha hai?");
    expect(reply1).toContain("क्षमा करें, मैं आपका संदेश समझ नहीं पाया");
    expect(reply1).toContain("ग्राहक सेवा"); // Still shows menu

    // Random attempt 2
    const reply2 = await processMenuMessage(testPhone, "kuch bol na bhai");
    expect(reply2).toContain("क्षमा करें, मैं आपका संदेश समझ नहीं पाया");

    // Random attempt 3 -> Triggers direct Customer Care handoff!
    const reply3 = await processMenuMessage(testPhone, "kya bot hai yeh");
    expect(reply3).toContain("कस्टमर केयर सहायता (Direct Customer Support)");
    expect(reply3).toContain("लगता है आपको किसी विशेष विषय पर सहायता चाहिए");
    expect(reply3).toContain(HELPLINE_NUMBER);
    expect(reply3).toContain("support@shifteronline.com");
    expect(reply3).toContain("सुबह 10:00 AM से शाम 6:00 PM");
  });

  test("9. Outbound messages include BACK hint in the footer", async () => {
    const reply = await processMenuMessage(testPhone, "Hello");
    expect(reply).toContain("पीछे जाने के लिए *BACK* या *0* लिखें");
    expect(reply).toContain("Type *BACK* to go back");
  });

  test("10. 1-Step Back Navigation: Detail Screen -> Category Menu -> Role Menu -> Language Menu", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "1"); // Hindi
    await processMenuMessage(testPhone, "1"); // Customer

    // User views Rates (subOption 3)
    const ratesReply = await processMenuMessage(testPhone, "3");
    expect(ratesReply).toContain("Shifter Online - वाहन व किराया दरें");
    expect(sessionManager.getSession(testPhone).data.subOption).toBe("3");

    // 1st BACK: From Rates detail back to Customer Menu
    const backToCustomerMenu = await processMenuMessage(testPhone, "back");
    expect(backToCustomerMenu).toContain("ग्राहक सेवा (Customer Support)");
    expect(backToCustomerMenu).toContain("1️⃣ गाड़ी बुक करें");
    expect(sessionManager.getSession(testPhone).step).toBe(STEPS.IN_MENU);
    expect(sessionManager.getSession(testPhone).data.subOption).toBeNull();

    // 2nd BACK: From Customer Menu back to Role Selection Menu
    const backToRoleMenu = await processMenuMessage(testPhone, "0");
    expect(backToRoleMenu).toContain("आप Shifter Online से किस रूप में जुड़ना चाहते हैं?");
    expect(backToRoleMenu).toContain("1️⃣ Customer");
    expect(sessionManager.getSession(testPhone).step).toBe(STEPS.AWAITING_ROLE);

    // 3rd BACK: From Role Selection Menu back to Language Menu
    const backToLangMenu = await processMenuMessage(testPhone, "wapas");
    expect(backToLangMenu).toContain("Welcome to Shifter Online!");
    expect(backToLangMenu).toContain("1️⃣ हिंदी (Hindi)");
    expect(sessionManager.getSession(testPhone).step).toBe(STEPS.AWAITING_LANGUAGE);
  });

  test("11. 1-Step Back Navigation: From Order ID prompt back to Customer Menu", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "3"); // Hinglish
    await processMenuMessage(testPhone, "1"); // Customer

    // Choose 2: Track Order prompt
    const promptReply = await processMenuMessage(testPhone, "2");
    expect(promptReply).toContain("Order ID number");
    expect(sessionManager.getSession(testPhone).step).toBe(STEPS.AWAITING_ORDER_ID);

    // Type 0 / back to return to Customer Menu
    const backReply = await processMenuMessage(testPhone, "0");
    expect(backReply).toContain("Customer Support");
    expect(backReply).toContain("1️⃣ Gadi Book Karein");
    expect(sessionManager.getSession(testPhone).step).toBe(STEPS.IN_MENU);
  });

  test("12. 1-Step Back Navigation: Regional Language Role -> Regional Menu -> Primary Language Menu", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "4"); // Regional menu
    await processMenuMessage(testPhone, "1"); // Marathi

    expect(sessionManager.getSession(testPhone).step).toBe(STEPS.AWAITING_ROLE);
    expect(sessionManager.getSession(testPhone).data.lang).toBe("mr");

    // Back from Marathi Role Menu -> Should return to Regional Language Menu!
    const backToRegional = await processMenuMessage(testPhone, "back");
    expect(backToRegional).toContain("Select Your Regional Language");
    expect(backToRegional).toContain("1️⃣ मराठी (Marathi)");
    expect(sessionManager.getSession(testPhone).step).toBe(STEPS.AWAITING_REGIONAL_LANGUAGE);

    // Back from Regional Language Menu -> Should return to Primary Language Menu!
    const backToPrimary = await processMenuMessage(testPhone, "0");
    expect(backToPrimary).toContain("Welcome to Shifter Online!");
    expect(backToPrimary).toContain("4️⃣ Other Indian Languages");
    expect(sessionManager.getSession(testPhone).step).toBe(STEPS.AWAITING_LANGUAGE);
  });

  test("13. Driver Partner: Menu has option 3 as Helpline (no plans option), option 1 Easy registration, option 2 Compulsory/Optional docs", async () => {
    await processMenuMessage(testPhone, "Hi");
    await processMenuMessage(testPhone, "3"); // Hinglish
    const driverMenu = await processMenuMessage(testPhone, "2"); // Driver Partner

    expect(driverMenu).toContain("Driver Partner Support");
    expect(driverMenu).toContain("1️⃣ Gadi Jodein");
    expect(driverMenu).toContain("2️⃣ Jaruri Documents");
    expect(driverMenu).toContain("3️⃣ Driver Helpline Number");
    expect(driverMenu).toContain("0️⃣ Main Menu par wapas jayein");
    expect(driverMenu).toContain("1, 2, 3 ya 0");
    expect(driverMenu).not.toContain("Kamai, Commission aur Plans");

    // Option 1: Attach Vehicle
    const opt1Reply = await processMenuMessage(testPhone, "1");
    expect(opt1Reply).toContain("Easy registration");
    expect(opt1Reply).not.toContain("Daily direct UPI / Bank payout");
    expect(opt1Reply).not.toContain("5 minute me aasan registration");

    // Option 2: Documents
    const opt2Reply = await processMenuMessage(testPhone, "2");
    expect(opt2Reply).toContain("Required Documents (Compulsory)");
    expect(opt2Reply).toContain("Aadhaar Card");
    expect(opt2Reply).toContain("Driving License");
    expect(opt2Reply).toContain("Vehicle RC");
    expect(opt2Reply).toContain("Optional Documents");
    expect(opt2Reply).toContain("PAN Card");
    expect(opt2Reply).toContain("Bank Details");
    expect(opt2Reply).toContain("PUC");
    expect(opt2Reply).toContain("Insurance (Bima)");

    // Option 3: Helpline
    const opt3Reply = await processMenuMessage(testPhone, "3");
    expect(opt3Reply).toContain("Driver Support Helpline");
    expect(opt3Reply).toContain(HELPLINE_NUMBER);

    // Option 4: Also returns Helpline for backward compatibility
    const opt4Reply = await processMenuMessage(testPhone, "4");
    expect(opt4Reply).toContain("Driver Support Helpline");
    expect(opt4Reply).toContain(HELPLINE_NUMBER);
  });
});

