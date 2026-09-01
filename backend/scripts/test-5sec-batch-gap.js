/**
 * 5-Second Staggered Batch Gap Test (Model 1 -> Model 2)
 */

const ioClient = require("socket.io-client");
const prisma = require("../src/lib/prisma");

const LOCAL_BASE_URL = "http://localhost:5000";
const BASE_LAT = 22.7402368;
const BASE_LNG = 75.913299;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function test5SecBatchGap() {
  console.log("=========================================================================");
  console.log("🧪 TESTING 5-SECOND BATCH GAP: MODEL 1 (T=0s) -> MODEL 2 (T=5s)");
  console.log("=========================================================================\n");

  const riderA = 13; // Model 1 driver
  const riderB = 32; // Model 2 driver

  // Step 1: Configure Driver A with ONLY Model 1 (pkg 6)
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
  const sockA = ioClient(LOCAL_BASE_URL, { transports: ["websocket"], forceNew: true });
  const sockB = ioClient(LOCAL_BASE_URL, { transports: ["websocket"], forceNew: true });
  const custSock = ioClient(LOCAL_BASE_URL, { transports: ["websocket"], forceNew: true });

  const events = [];

  await Promise.all([
    new Promise((resolve) => {
      sockA.on("connect", () => {
        sockA.emit("driver:join", { rider_id: riderA, lat: BASE_LAT, lng: BASE_LNG });
        sockA.on("order:request", (data) => {
          const delta = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`🔔 [DRIVER A - Model 1] Received Offer at T=${delta}s! (Order #${data.order_id}, pkg ${data.package_id})`);
          events.push({ driver: "A", time: delta, data });
        });
        resolve();
      });
    }),
    new Promise((resolve) => {
      sockB.on("connect", () => {
        sockB.emit("driver:join", { rider_id: riderB, lat: BASE_LAT, lng: BASE_LNG });
        sockB.on("order:request", (data) => {
          const delta = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`🔔 [DRIVER B - Model 2] Received Offer at T=${delta}s! (Order #${data.order_id}, pkg ${data.package_id})`);
          events.push({ driver: "B", time: delta, data });
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
  console.log("Placing order with Customer selecting [Model 1, Model 2]...");
  const startTime = Date.now();

  const createRes = await fetch(`${LOCAL_BASE_URL}/api/order/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uid: 7,
      category: "Bike",
      delivery_type: [6, 7],
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
  console.log(`✓ Order #${orderId} created! Waiting 10 seconds to observe timing...\n`);

  await sleep(10000);

  console.log("\n=========================================================================");
  console.log("📊 TIMING RESULTS:");
  console.log("=========================================================================");
  events.forEach((e) => {
    console.log(`• Driver ${e.driver} (Model ${e.data.package_id === "6" ? "1" : "2"}): Offered at T=${e.time}s`);
  });

  const driverAEvent = events.find((e) => e.driver === "A");
  const driverBEvent = events.find((e) => e.driver === "B");

  if (driverAEvent && driverBEvent) {
    const diff = Math.abs(Number(driverBEvent.time) - Number(driverAEvent.time));
    console.log(`\nTime Difference Between Model 1 and Model 2: ~${diff.toFixed(1)} seconds`);
    if (diff >= 4.5 && diff <= 7.5) {
      console.log("✅ PERFECT! Model 1 rang first, and Model 2 rang exactly ~5 seconds later like batches!");
    }
  }

  // Cleanup
  sockA.disconnect();
  sockB.disconnect();
  custSock.disconnect();
  await prisma.tbl_order_requests.deleteMany({ where: { order_id: orderId } });
  await prisma.pkg_order.delete({ where: { id: orderId } });
  await prisma.$disconnect();

  process.exit(0);
}

test5SecBatchGap().catch(async (e) => {
  console.error("Test error:", e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
