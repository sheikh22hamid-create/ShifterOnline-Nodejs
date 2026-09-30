require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { parseMessageWithAI } = require("../src/whatsapp/groqService");

async function runTests() {
  console.log("=== Testing WhatsApp Bot AI Integration ===");
  console.log("GEMINI_API_KEY configured:", !!process.env.GEMINI_API_KEY);
  console.log("GROQ_API_KEY configured:", !!process.env.GROQ_API_KEY);

  const testQueries = [
    "Indore se Bhopal tempo book karna hai kitna lagega?",
    "Driver kaise bane?",
    "Mera wallet balance kitna hai?",
    "Customer care number do"
  ];

  for (const q of testQueries) {
    console.log(`\n--- Query: "${q}" ---`);
    const res = await parseMessageWithAI(q);
    console.log(`Intent: ${res.intent}`);
    console.log(`AI Response: ${res.aiResponse}`);
  }

  console.log("\n✅ All test queries processed successfully!");
}

runTests().catch(console.error);
