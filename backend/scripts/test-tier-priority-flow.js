/**
 * Tier Priority Verification Test
 * 
 * Verifies that:
 * 1. Driver A has ONLY Model 1 enabled.
 * 2. Driver B has ONLY Model 2 enabled.
 * 3. When Customer selects [Model 1, Model 2], Driver A gets 100% exclusive priority.
 * 4. Driver B receives ZERO offers while Driver A is within their 15s decision window!
 */

const ioClient = require("socket.io-client");
const prisma = require("../src/lib/prisma");

const LOCAL_BASE_URL = "http://localhost:5000";
const BASE_LAT = 22.7402368;
const BASE_LNG = 75.913299;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testTierPriority() {
  console.log("=========================================================================");
  console.log("🧪 TESTING TIER 0 (MODEL 1) EXCLUSIVE PRIORITY OVER TIER 1 (MODEL 2)");
  console.log("=========================================================================\n");

  const riderA = 13; // Model 1 driver
  const riderB = 32; // Model 2 driver

  // Step 1: Configure Driver A with ONLY Model 1 (pkg 6)
  console.log("1. Configuring Driver A (#13) with ONLY Model 1...");
  await prisma.tbl_rider_delivery_type.updateMany({ where: { rider_id: riderA }, data: { status: 0 } });
  await prisma.tbl_rider_delivery_type.updateMany({
    where: { rider_id: riderA, delivery_type: "6" },
    data: { status: 1 },
  });
  await prisma.tbl_rider.update({
    where: { id: riderA },
    data: { a_status: 1, rlats: String(BASE_LAT), rlongs: String(BASE_LNG) },
  });

  // Step 2: Configure Driver B with ONLY Model 2 (pkg 7)
  console.log("2. Configuring Driver B (#32) with ONLY Model 2...");
  await prisma.tbl_rider_delivery_type.updateMany({ where: { rider_id: riderB }, data: { status: 0 } });
  await prisma.tbl_rider_delivery_type.updateMany({
    where: { rider_id: riderB, delivery_type: "7" },
    data: { status: 1 },
  });
  await prisma.tbl_rider.update({
    where: { id: riderB },
    data: { a_status: 1, rlats: String(BASE_LAT), rlongs: String(BASE_LNG) },
  });

  // Step 3: Connect sockets
  console.log("\n3. Connecting Sockets for Driver A & Driver B...");
  const sockA = ioClient(LOCAL_BASE_URL, { transports: ["websocket"], forceNew: true });
  const sockB = ioClient(LOCAL_BASE_URL, { transports: ["websocket"], forceNew: true });
  const custSock = ioClient(LOCAL_BASE_URL, { transports: ["websocket"], forceNew: true });

  const eventsA = [];
  const eventsB = [];

  await Promise.all([
    new Promise((resolve) => {
      sockA.on("connect", () => {
        sockA.emit("driver:join", { rider_id: riderA, lat: BASE_LAT, lng: BASE_LNG });
        sockA.on("order:request", (data) => {
          console.log(`\n🔔 [DRIVER A - Model 1] Received Offer for Order #${data.order_id} (pkg ${data.package_id}) at T=${(Date.now() - startTime) / 1000}s!`);
          eventsA.push({ time: Date.now(), data });
        });
        resolve();
      });
    }),
    new Promise((resolve) => {
      sockB.on("connect", () => {
        sockB.emit("driver:join", { rider_id: riderB, lat: BASE_LAT, lng: BASE_LNG });
        sockB.on("order:request", (data) => {
          console.log(`\n⚠️ [DRIVER B - Model 2] Received Offer for Order #${data.order_id} (pkg ${data.package_id}) at T=${(Date.now() - startTime) / 1000}s!`);
          eventsB.push({ time: Date.now(), data });
        });
        resolve();
      });
    }),
    new Promise((resolve) => {
      custSock.on("connect", () => {
        custSock.emit("customer:join", { user_id: 7 });
        resolve();
      });
    }),
  ]);

  // Step 4: Place Order with BOTH Model 1 & Model 2 enabled
  console.log("\n4. Customer placing order with BOTH Model 1 (pkg 6) & Model 2 (pkg 7)...");
  const startTime = Date.now();

  const createRes = await fetch(`${LOCAL_BASE_URL}/api/order/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uid: 7,
      category: "Bike",
      delivery_type: [6, 7], // Customer selected Model 1 & Model 2
      booking_type: 1,
      plat: BASE_LAT,
      plong: BASE_LNG,
      paddress: "Indore Hub",
      pick_name: "Customer",
      pmobile: "9999900007",
      dlat: BASE_LAT - 0.02,
      dlong: BASE_LNG - 0.03,
      daddress: "Indore Drop",
      drop_name: "Recipient",
      dmobile: "9999900008",
      package_weight: "1.0",
      package_cost: 100,
      radius_km: 10,
    }),
  });

  const createJson = await createRes.json();
  const orderId = Number(createJson.order_id);
  console.log(`✓ Order #${orderId} created!`);

  // Wait 7 seconds (which is past the old 5s BATCH_GAP_MS)
  console.log("\n5. Monitoring incoming requests over the first 7 seconds...");
  await sleep(7000);

  const t7Seconds = (Date.now() - startTime) / 1000;
  console.log(`\n⏱️ At T=${t7Seconds.toFixed(1)}s checkpoint:`);
  console.log(`   Driver A (Model 1) offers received: ${eventsA.length}`);
  console.log(`   Driver B (Model 2) offers received: ${eventsB.length}`);

  let passed = false;
  if (eventsA.length === 1 && eventsB.length === 0) {
    console.log("\n🎉 TEST PASSED! Driver A (Model 1) received the offer exclusively.");
    console.log("   Driver B (Model 2) did NOT receive any offer while Driver A was considering!");
    passed = true;
  } else if (eventsB.length > 0) {
    console.error("\n❌ TEST FAILED! Driver B received an offer concurrently with Driver A!");
  } else {
    console.error("\n❌ TEST FAILED! Driver A did not receive an offer.");
  }

  // Cleanup
  sockA.disconnect();
  sockB.disconnect();
  custSock.disconnect();
  await prisma.tbl_order_requests.deleteMany({ where: { order_id: orderId } });
  await prisma.pkg_order.delete({ where: { id: orderId } });
  await prisma.$disconnect();

  process.exit(passed ? 0 : 1);
}

testTierPriority().catch(async (e) => {
  console.error("Test error:", e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
