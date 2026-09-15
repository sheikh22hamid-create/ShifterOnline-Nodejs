require("dotenv").config();
const groqService = require("../src/whatsapp/groqService");

async function test() {
  console.log("=== GROQ API KEYS CONFIGURATION ===");
  const keys = groqService.getGroqApiKeys ? groqService.getGroqApiKeys() : [];
  console.log(`Total configured Groq API keys: ${keys.length}`);
  keys.forEach((k, idx) => {
    console.log(`  Key #${idx + 1}: ${k.slice(0, 10)}...${k.slice(-6)}`);
  });

  console.log("\n=== TESTING GROQ PARSER WITH FAILOVER ===");
  const res = await groqService.parseMessageWithGroq("Tata Ace ka kiraya kitna hoga?");
  console.log("Parse Result:", JSON.stringify(res, null, 2));
}

test().catch(console.error);
