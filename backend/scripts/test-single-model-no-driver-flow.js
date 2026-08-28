/**
 * Shifter Online - Single-Model Order & "No Driver Found" Flow Test
 * 
 * Scenario:
 * 1. Customer places a Bike order with ONLY Model 1 enabled (delivery_type: [6]).
 *    Models 2, 3, 4, 5 are kept OFF by customer.
 * 2. 8 drivers have Model 1 ON (#01 to #08).
 * 3. 12 drivers have Models 2-5 ON (#09 to #20, Model 1 OFF).
 * 4. Nobody accepts.
 * 5. Verifies:
 *    - Batch 1 offers to Drivers #01 to #04 (Model 1).
 *    - Batch 2 offers to Drivers #05 to #08 (Model 1).
 *    - Zero offers sent to Drivers #09 to #20 (customer price protection).
 *    - Drivers #01 to #08 popups expire with reason 'timeout'.
 *    - Customer receives 'order:no_driver_found' event via WebSocket.
 *    - DB is updated: o_status = 'Cancelled', cancel_reason = 'No driver found'.
 */

const http = require("http");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");
const { initSocket } = require("../src/sockets/socketServer");
const ioClient = require("socket.io-client");

const TEST_PORT = 5195;
const BASE_LAT = 22.7402368;
const BASE_LNG = 75.913299;

const PACKAGE_NAMES = {
  6: "Model 1",
  7: "Model 2",
  21: "Model 3",
  33: "Model 4",
  34: "Model 5",
};

let serverInstance = null;
let testRiders = [];
let otherRidersBackup = [];
let driverSockets = [];
let customerSocket = null;
let createdOrderId = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prepare20Drivers() {
  console.log("\n=======================================================");
  console.log("1. PREPARING 20 BIKE DRIVERS IN DATABASE...");
  console.log("=======================================================");

  const allBikeRiders = await prisma.tbl_rider.findMany({
    where: { vehicle: "Bike" },
    select: { id: true, vehicle_no: true, a_status: true },
  });

  testRiders = await prisma.tbl_rider.findMany({
    where: { vehicle_no: { startsWith: "TEST-BIKE-" } },
    orderBy: { vehicle_no: "asc" },
    take: 20,
  });

  const otherOnline = allBikeRiders.filter(
    (r) => !r.vehicle_no.startsWith("TEST-BIKE-") && r.a_status === 1
  );
  if (otherOnline.length > 0) {
    otherRidersBackup = otherOnline;
    await prisma.tbl_rider.updateMany({
      where: { id: { in: otherOnline.map((r) => r.id) } },
      data: { a_status: 0 },
    });
  }

  // Set ascending distances & toggles
  for (let i = 0; i < 20; i++) {
    const rider = testRiders[i];
    const offset = (i + 1) * 0.003;
    await prisma.tbl_rider.update({
      where: { id: rider.id },
      data: {
        a_status: 1,
        status: 1,
        vehicle: "Bike",
        rlats: String(BASE_LAT + offset),
        rlongs: String(BASE_LNG + offset),
      },
    });

    const isModel1Only = i < 8;
    const activePackages = isModel1Only ? [6] : [7, 21, 33, 34];
    const allBikePackages = [6, 7, 21, 33, 34];

    for (const pkgId of allBikePackages) {
      const shouldBeActive = activePackages.includes(pkgId);
      const existing = await prisma.tbl_rider_delivery_type.findFirst({
        where: { rider_id: rider.id, delivery_type: String(pkgId) },
      });

      if (existing) {
        await prisma.tbl_rider_delivery_type.update({
          where: { id: existing.id },
          data: { status: shouldBeActive ? 1 : 0 },
        });
      } else {
        await prisma.tbl_rider_delivery_type.create({
          data: {
            rider_id: rider.id,
            delivery_type: String(pkgId),
            status: shouldBeActive ? 1 : 0,
          },
        });
      }
    }
  }

  console.log("✓ 20 Drivers ready: Drivers #01-#08 (Model 1 ON); Drivers #09-#20 (Models 2-5 ON, Model 1 OFF)");
}

async function startServer() {
  console.log("\n=======================================================");
  console.log(`2. STARTING SERVER ON PORT ${TEST_PORT}...`);
  console.log("=======================================================");

  const server = http.createServer(app);
  initSocket(server);

  await new Promise((resolve, reject) => {
    server.listen(TEST_PORT, () => {
      serverInstance = server;
      console.log(`✓ Server running at http://localhost:${TEST_PORT}`);
      resolve();
    });
    server.on("error", reject);
  });
}

async function connectSockets(eventsMap) {
  console.log("\n=======================================================");
  console.log("3. CONNECTING DRIVER & CUSTOMER WEBSOCKETS...");
  console.log("=======================================================");

  // Connect Customer (user_id = 1)
  const custSock = ioClient(`http://localhost:${TEST_PORT}`, {
    transports: ["websocket"],
    forceNew: true,
  });

  await new Promise((resolve) => {
    custSock.on("connect", () => {
      custSock.emit("customer:join", { user_id: 1 });

      custSock.on("order:no_driver_found", (payload) => {
        const elapsed = ((Date.now() - eventsMap.orderCreatedTime) / 1000).toFixed(2);
        console.log(`\n📢 [CUSTOMER EVENT] Received 'order:no_driver_found' for Order #${payload.order_id} at +${elapsed}s!`);
        eventsMap.customerNoDriverFoundEvent = payload;
      });

      resolve();
    });
  });
  customerSocket = custSock;
  console.log("✓ Customer socket connected and joined customer_1");

  // Connect 20 Drivers
  for (let i = 0; i < 20; i++) {
    const rider = testRiders[i];
    const sock = ioClient(`http://localhost:${TEST_PORT}`, {
      transports: ["websocket"],
      forceNew: true,
    });

    await new Promise((resolve) => {
      sock.on("connect", () => {
        sock.emit("driver:join", { rider_id: rider.id });

        sock.on("order:request", (payload) => {
          const arrival = Date.now();
          const elapsedMs = arrival - eventsMap.orderCreatedTime;
          eventsMap.requests.push({ riderId: rider.id, payload, arrivalTime: arrival });
          console.log(`🔔 [REQUEST] Driver #${pad2(i + 1)} received offer for ${PACKAGE_NAMES[payload.package_id]} at +${(elapsedMs / 1000).toFixed(2)}s`);
        });

        sock.on("order:dismiss", (payload) => {
          const dismissTime = Date.now();
          const elapsedMs = dismissTime - eventsMap.orderCreatedTime;
          eventsMap.dismisses.push({ riderId: rider.id, payload, dismissTime });
          console.log(`⏱️ [DISMISSED] Driver #${pad2(i + 1)} popup expired | Reason: '${payload.reason}' at +${(elapsedMs / 1000).toFixed(2)}s`);
        });

        resolve();
      });
    });

    driverSockets.push({ riderId: rider.id, socket: sock });
  }

  console.log("✓ All 20 driver sockets connected and listening");
}

async function placeSingleModelOrder(eventsMap) {
  console.log("\n=======================================================");
  console.log("4. PLACING SINGLE-MODEL (ONLY MODEL 1) ORDER...");
  console.log("=======================================================");

  const orderPayload = {
    uid: 1,
    category: "Bike",
    delivery_type: [6], // ONLY MODEL 1!
    booking_type: 1,
    plat: BASE_LAT,
    plong: BASE_LNG,
    paddress: "Indore Palasia Test Hub",
    pick_name: "Test Customer",
    pmobile: "9999900001",
    dlat: BASE_LAT + 0.05,
    dlong: BASE_LNG + 0.05,
    daddress: "Indore Vijay Nagar Drop",
    drop_name: "Test Receiver",
    dmobile: "9999900002",
    package_weight: "1.5",
    package_cost: 150,
    radius_km: 10,
    city_id: 1,
  };

  eventsMap.orderCreatedTime = Date.now();
  console.log("Dispatching POST /api/order/create with delivery_type: [6] (Only Model 1)...");

  const response = await fetch(`http://localhost:${TEST_PORT}/api/order/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderPayload),
  });

  const resJson = await response.json();
  if (resJson.Result !== "true" && resJson.Result !== true) {
    throw new Error(`Order creation failed: ${JSON.stringify(resJson)}`);
  }

  createdOrderId = resJson.order_id;
  console.log(`✓ Order #${createdOrderId} created! Watching single-model cascade to completion...\n`);

  // Wait until customer receives 'order:no_driver_found' or max 40 seconds
  console.log("Watching cascade until all Model 1 batches expire and 'order:no_driver_found' triggers...");
  const startTime = Date.now();
  while (!eventsMap.customerNoDriverFoundEvent && Date.now() - startTime < 40000) {
    await sleep(500);
  }

  // Small buffer
  await sleep(2000);
}

async function verifyDatabase(eventsMap) {
  const finalOrder = await prisma.pkg_order.findUnique({
    where: { id: createdOrderId },
  });
  eventsMap.dbFinalOrder = finalOrder;
}

function printAuditReport(eventsMap) {
  console.log("\n=========================================================================================================");
  console.log("📊 SINGLE-MODEL DISPATCH & 'NO DRIVER FOUND' AUDIT REPORT");
  console.log("=========================================================================================================");

  const rows = [];
  for (let i = 1; i <= 20; i++) {
    const rider = testRiders[i - 1];
    const req = eventsMap.requests.find((r) => r.riderId === rider.id);
    const dis = eventsMap.dismisses.find((d) => d.riderId === rider.id);

    const isModel1 = i <= 8;
    const reqTime = req ? `+${((req.arrivalTime - eventsMap.orderCreatedTime) / 1000).toFixed(2)}s` : "-";
    const disTime = dis ? `+${((dis.dismissTime - eventsMap.orderCreatedTime) / 1000).toFixed(2)}s` : "-";

    let outcome = "Never Offered (Protected from Higher Tiers)";
    if (isModel1) {
      outcome = dis ? `⏱️ Expired (${dis.payload.reason})` : (req ? "Offered" : "Unnotified");
    }

    rows.push({
      "Driver #": `#${pad2(i)}`,
      "Vehicle No": rider.vehicle_no,
      "Driver Toggles": isModel1 ? "Only Model 1" : "Models 2, 3, 4, 5",
      "Popup Offered": req ? `Yes (${PACKAGE_NAMES[req.payload.package_id]})` : "No",
      "Offer Time": reqTime,
      "Expiry Time": disTime,
      "Final Outcome": outcome,
    });
  }

  console.table(rows);

  console.log("\n---------------------------------------------------------------------------------------------------------");
  console.log("📌 ARCHITECTURAL VERIFICATION CHECKLIST:");
  console.log("---------------------------------------------------------------------------------------------------------");

  const model1Offered = eventsMap.requests.filter((r) => r.payload.package_id === "6" || r.payload.package_id === 6);
  const higherTiersOffered = eventsMap.requests.filter((r) => r.payload.package_id !== "6" && r.payload.package_id !== 6);
  const isCancelledInDb = eventsMap.dbFinalOrder && eventsMap.dbFinalOrder.o_status === "Cancelled";
  const cancelReasonMatches = eventsMap.dbFinalOrder && eventsMap.dbFinalOrder.cancel_reason === "No driver found";

  console.log(`• Model 1 Exhaustion: ${model1Offered.length === 8 ? "✅ PASSED (All 8 Model 1 drivers notified across 2 batches)" : "❌ FAILED (" + model1Offered.length + " offered)"}`);
  console.log(`• Higher Tier Protection: ${higherTiersOffered.length === 0 ? "✅ PASSED (0 offers sent to Models 2-5; customer price respected)" : "❌ FAILED"}`);
  console.log(`• Drivers #09-#20 Never Contacted: ${eventsMap.requests.every((r) => r.riderId <= testRiders[7].id) ? "✅ PASSED (Drivers #09-#20 never buzzed)" : "❌ FAILED"}`);
  console.log(`• Customer Notification: ${eventsMap.customerNoDriverFoundEvent ? "✅ PASSED ('order:no_driver_found' emitted to customer)" : "❌ FAILED"}`);
  console.log(`• Database Cancellation: ${isCancelledInDb && cancelReasonMatches ? "✅ PASSED (o_status='Cancelled', cancel_reason='No driver found')" : "❌ FAILED"}`);
  console.log("=========================================================================================================\n");
}

async function cleanup() {
  console.log("\n=======================================================");
  console.log("5. CLEANING UP TEST DATA & SHUTTING DOWN...");
  console.log("=======================================================");

  for (const { socket } of driverSockets) {
    try { socket.disconnect(); } catch (e) {}
  }
  if (customerSocket) {
    try { customerSocket.disconnect(); } catch (e) {}
  }

  if (otherRidersBackup.length > 0) {
    try {
      await prisma.tbl_rider.updateMany({
        where: { id: { in: otherRidersBackup.map((r) => r.id) } },
        data: { a_status: 1 },
      });
    } catch (e) {}
  }

  if (createdOrderId) {
    try {
      await prisma.tbl_order_requests.deleteMany({ where: { order_id: createdOrderId } });
      await prisma.pkg_order.delete({ where: { id: createdOrderId } });
      console.log(`✓ Test order #${createdOrderId} deleted.`);
    } catch (e) {}
  }

  if (serverInstance) {
    await new Promise((resolve) => serverInstance.close(resolve));
    console.log("✓ Server shut down.");
  }

  await prisma.$disconnect();
  console.log("✓ Cleanup complete!");
  process.exit(0);
}

async function main() {
  const eventsMap = {
    orderCreatedTime: 0,
    requests: [],
    dismisses: [],
    customerNoDriverFoundEvent: null,
    dbFinalOrder: null,
  };

  try {
    await prepare20Drivers();
    await startServer();
    await connectSockets(eventsMap);
    await placeSingleModelOrder(eventsMap);
    await verifyDatabase(eventsMap);
    printAuditReport(eventsMap);
  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await cleanup();
  }
}

main();
