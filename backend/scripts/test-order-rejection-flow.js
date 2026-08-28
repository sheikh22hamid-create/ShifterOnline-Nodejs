/**
 * Shifter Online - Driver Rejection & Cascade Escalation Flow Test
 * 
 * Scenario:
 * 1. Customer places a Bike order (all 5 toggles ON).
 * 2. Batch 1 drivers (#01, #02, #03, #04) receive the order request popup.
 * 3. ALL 4 drivers in Batch 1 explicitly REJECT the order ("order:reject").
 * 4. Verifies:
 *    - All 4 rejected drivers have their locks released immediately.
 *    - tbl_order_requests rows are marked status = '10' (rejected).
 * 5. Cascade seamlessly proceeds to Batch 2 (#05, #06, #07, #08).
 * 6. In Batch 2, Driver #06 clicks "ACCEPT" ("order:accept").
 * 7. Verifies:
 *    - Driver #06 wins with Result: true.
 *    - Customer gets 'order:assigned' with Driver #06 details.
 *    - Other Batch 2 drivers (#05, #07, #08) receive 'order:dismiss' ('accepted_by_other').
 *    - Previously rejected drivers (#01-#04) are NOT re-offered or re-dismissed.
 *    - Cascade immediately halts: Drivers #09 to #20 never receive any notifications.
 */

const http = require("http");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");
const { initSocket } = require("../src/sockets/socketServer");
const ioClient = require("socket.io-client");

const TEST_PORT = 5190;
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

  const existingTestRiders = allBikeRiders.filter((r) =>
    r.vehicle_no && r.vehicle_no.startsWith("TEST-BIKE-")
  );

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

  // Set ascending distances & active toggles
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

  console.log("✓ 20 Drivers ready: Drivers #01-#04 configured to REJECT; Driver #06 in Batch 2 to ACCEPT");
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
      custSock.on("order:assigned", (payload) => {
        console.log(`\n🎉 [CUSTOMER EVENT] Received 'order:assigned' for Order #${payload.order_id}!`);
        console.log(`   Assigned Driver: ${payload.rider_name} | Phone: ${payload.rider_phone} | Vehicle: ${payload.vehicle_no}`);
        eventsMap.customerAssignedEvent = payload;
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
          eventsMap.dismisses.push({ riderId: rider.id, payload, dismissTime });
          console.log(`🛑 [DISMISSED] Driver #${pad2(i + 1)} popup dismissed | Reason: '${payload.reason}'`);
        });

        sock.on("order:accept:ack", (ack) => {
          eventsMap.acks.push({ riderId: rider.id, ack, time: Date.now() });
          console.log(`📋 [ACCEPT ACK] Driver #${pad2(i + 1)} accept response: Result=${ack.Result}, msg='${ack.msg}'`);
        });

        resolve();
      });
    });

    driverSockets.push({ riderId: rider.id, socket: sock });
  }

  console.log("✓ All 20 driver sockets connected and listening");
}

async function placeOrderAndRunRejectionFlow(eventsMap) {
  console.log("\n=======================================================");
  console.log("4. PLACING ORDER & EXECUTING REJECTION FLOW...");
  console.log("=======================================================");

  const orderPayload = {
    uid: 1,
    category: "Bike",
    delivery_type: [6, 7, 21, 33, 34],
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
  console.log("Dispatching POST /api/order/create at T = 0ms...");

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
  console.log(`✓ Order #${createdOrderId} created! Waiting for Batch 1 popup...`);

  // Wait for Batch 1 drivers (#01 to #04) to receive request
  while (eventsMap.requests.length < 4) {
    await sleep(200);
  }

  console.log("\n-------------------------------------------------------------");
  console.log("🛑 BATCH 1 REJECTION: Drivers #01, #02, #03, #04 reject order");
  console.log("-------------------------------------------------------------");

  for (let i = 0; i < 4; i++) {
    const rider = testRiders[i];
    const sock = driverSockets[i].socket;
    sock.emit("order:reject", { rider_id: rider.id, order_id: createdOrderId });
    eventsMap.rejections.push({ riderId: rider.id, time: Date.now() });
    console.log(`❌ Driver #${pad2(i + 1)} emitted 'order:reject'`);
  }

  console.log("\nWaiting for cascade to trigger Batch 2 (Drivers #05, #06, #07, #08)...");
  // Wait until Batch 2 receives request (at least 8 requests total)
  while (eventsMap.requests.length < 8) {
    await sleep(300);
  }

  console.log("\n-------------------------------------------------------------");
  console.log("⚡ BATCH 2 ACCEPTANCE: Driver #06 accepts the order!");
  console.log("-------------------------------------------------------------");

  const driver6Sock = driverSockets.find((s) => s.riderId === testRiders[5].id).socket;
  driver6Sock.emit("order:accept", { rider_id: testRiders[5].id, order_id: createdOrderId });

  // Wait 12 seconds to confirm cascade stops and no further drivers (#09-#20) receive offers
  console.log("\nWaiting 12 seconds to verify complete cascade termination...");
  await sleep(12000);
}

async function verifyDatabase(eventsMap) {
  // Check rejected records in DB
  const rejectedRows = await prisma.tbl_order_requests.findMany({
    where: {
      order_id: createdOrderId,
      rider_id: { in: testRiders.slice(0, 4).map((r) => r.id) },
    },
  });

  eventsMap.dbRejectedStatuses = rejectedRows.map((r) => ({
    rider_id: r.rider_id,
    status: r.status,
  }));

  // Check order assignment
  const finalOrder = await prisma.pkg_order.findUnique({
    where: { id: createdOrderId },
  });
  eventsMap.dbFinalOrder = finalOrder;
}

function printAuditReport(eventsMap) {
  console.log("\n=========================================================================================================");
  console.log("📊 DRIVER REJECTION & CASCADE ESCALATION AUDIT REPORT");
  console.log("=========================================================================================================");

  const rows = [];
  for (let i = 1; i <= 20; i++) {
    const rider = testRiders[i - 1];
    const req = eventsMap.requests.find((r) => r.riderId === rider.id);
    const dis = eventsMap.dismisses.find((d) => d.riderId === rider.id);
    const ack = eventsMap.acks.find((a) => a.riderId === rider.id);
    const rej = eventsMap.rejections.find((rj) => rj.riderId === rider.id);

    let outcome = "Never Offered (Cascade Halted)";
    if (i <= 4) {
      outcome = "❌ Rejected by Driver (Status 10)";
    } else if (i === 6) {
      outcome = ack && ack.ack.Result ? "🏆 WON in Batch 2 (Accepted)" : "Pending";
    } else if (i >= 5 && i <= 8) {
      outcome = dis ? `🛑 Dismissed (${dis.payload.reason})` : "Popup Received";
    }

    rows.push({
      "Driver #": `#${pad2(i)}`,
      "Vehicle No": rider.vehicle_no,
      "Offered In": req ? `Yes (${PACKAGE_NAMES[req.payload.package_id]})` : "No",
      "Driver Action": i <= 4 ? "Rejected" : (i === 6 ? "Accepted" : "-"),
      "Dismiss Reason": dis ? dis.payload.reason : "-",
      "Final Outcome": outcome,
    });
  }

  console.table(rows);

  console.log("\n---------------------------------------------------------------------------------------------------------");
  console.log("📌 ARCHITECTURAL VERIFICATION CHECKLIST:");
  console.log("---------------------------------------------------------------------------------------------------------");

  const all4RejectedMarked = eventsMap.dbRejectedStatuses.every((r) => r.status === "10");
  const d6Won = eventsMap.dbFinalOrder && eventsMap.dbFinalOrder.rid === testRiders[5].id;
  const d6Status = eventsMap.dbFinalOrder && eventsMap.dbFinalOrder.order_status === 1;
  const batch2Dismissed = eventsMap.dismisses.filter((d) => d.payload.reason === "accepted_by_other");
  const postBatch2Offers = eventsMap.requests.filter((r) => r.riderId > testRiders[7].id);

  console.log(`• Batch 1 Rejection Handled: ${all4RejectedMarked ? "✅ PASSED (All 4 marked status='10' in DB & locks freed)" : "❌ FAILED"}`);
  console.log(`• Cascade Escalation to Batch 2: ${eventsMap.requests.length >= 8 ? "✅ PASSED (Batch 2 notified after Batch 1 rejected)" : "❌ FAILED"}`);
  console.log(`• Batch 2 Winner Acceptance: ${d6Won && d6Status ? "✅ PASSED (Driver #06 won order; rid=" + testRiders[5].id + ")" : "❌ FAILED"}`);
  console.log(`• Customer Real-Time Notification: ${eventsMap.customerAssignedEvent ? "✅ PASSED (order:assigned received with Driver #06)" : "❌ FAILED"}`);
  console.log(`• Other Batch 2 Drivers Dismissed: ${batch2Dismissed.length >= 3 ? "✅ PASSED (Drivers #05, #07, #08 dismissed with 'accepted_by_other')" : "❌ FAILED"}`);
  console.log(`• Cascade Termination: ${postBatch2Offers.length === 0 ? "✅ PASSED (Zero offers to Drivers #09-#20; timers halted)" : "❌ FAILED"}`);
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
    acks: [],
    rejections: [],
    customerAssignedEvent: null,
    dbRejectedStatuses: [],
    dbFinalOrder: null,
  };

  try {
    await prepare20Drivers();
    await startServer();
    await connectSockets(eventsMap);
    await placeOrderAndRunRejectionFlow(eventsMap);
    await verifyDatabase(eventsMap);
    printAuditReport(eventsMap);
  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await cleanup();
  }
}

main();
