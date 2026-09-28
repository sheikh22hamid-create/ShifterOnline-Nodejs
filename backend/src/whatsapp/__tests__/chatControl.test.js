const chatControl = require("../chatControl");

describe("WhatsApp Chat Pause/Resume Control", () => {
  const testPhone = "9999900001";

  beforeEach(() => {
    chatControl.resumeChat(testPhone);
  });

  test("should detect stop and start commands accurately", () => {
    expect(chatControl.isStopCommand("stop")).toBe(true);
    expect(chatControl.isStopCommand("/stop")).toBe(true);
    expect(chatControl.isStopCommand("Stop")).toBe(true);
    expect(chatControl.isStopCommand("bot stop")).toBe(true);
    expect(chatControl.isStopCommand("stop bot")).toBe(true);
    expect(chatControl.isStopCommand("pause")).toBe(true);
    expect(chatControl.isStopCommand("hello")).toBe(false);

    expect(chatControl.isStartCommand("/start")).toBe(true);
    expect(chatControl.isStartCommand("start")).toBe(true);
    expect(chatControl.isStartCommand("start bot")).toBe(true);
    expect(chatControl.isStartCommand("/resume")).toBe(true);
    expect(chatControl.isStartCommand("fare")).toBe(false);
  });

  test("should pause and resume specific chat without affecting others", () => {
    const otherPhone = "9999900002";
    
    expect(chatControl.isChatPaused(testPhone)).toBe(false);
    expect(chatControl.isChatPaused(otherPhone)).toBe(false);

    // Pause test phone
    chatControl.pauseChat(testPhone);
    expect(chatControl.isChatPaused(testPhone)).toBe(true);
    expect(chatControl.isChatPaused(otherPhone)).toBe(false); // Other chats unaffected!

    // Resume test phone
    chatControl.resumeChat(testPhone);
    expect(chatControl.isChatPaused(testPhone)).toBe(false);
    expect(chatControl.isChatPaused(otherPhone)).toBe(false);
  });
});
