const prisma = require("../src/config/db");
const { checkReferral, applyReferral } = require("../src/controllers/riderController");

async function test() {
  try {
    // 1. Check valid referral
    console.log("--- Testing checkReferral ---");
    const mockRes1 = {
      status: (code) => ({
        json: (data) => {
          console.log("checkReferral response:", code, data);
          return data;
        },
      }),
    };
    await checkReferral({ body: { referral_code: "LIVTAWVF" } }, mockRes1);

    // 2. Check invalid referral
    await checkReferral({ body: { referral_code: "INVALID999" } }, mockRes1);

    console.log("--- Backend verification finished ---");
  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
