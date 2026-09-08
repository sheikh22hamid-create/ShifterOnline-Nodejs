/**
 * Shifter Online - 3 Nearby Drivers, All Models ON - Dispatch Timing Test
 *
 * Scenario:
 * - 1 customer places 1 Bike order with all 5 model toggles allowed
 *   (allowed_delivery_types: [6, 7, 21, 33, 34] = Model 1..Model 5)
 * - 3 Bike drivers online nearby, ALL with ALL 5 model toggles ON
 * - Measures exactly which driver gets the "order:request" popup, for which
 *   model tier, at what elapsed time, and exactly how long that popup stays
 *   on their screen before "order:dismiss" (timeout) fires.
 */

const http = require("http");
const prisma = require("../src/config/db");
const app = require("../src/app");
const { initSocket } = require("../src/sockets/socketServer");
const ioClient = require("socket.io-client");

const TEST_PORT = 5171;
const BASE_LAT = 22.7402368;
const BASE_LNG = 75.913299;

const BIKE_PACKAGE_IDS = [6, 7, 21, 33, 34]; // Model 1 to Model 5
const PACKAGE_NAMES = {
  6: "Model 1",
  7: "Model 2",
  21: "Model 3",
  33: "Model 4",
  34: "Model 5",
};

let serverInstance = null;
let sockets = [];
let otherRidersBackup = [];
let testRiders = [];
let createdOrderId = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prepare3Drivers() {
  console.log("\n=======================================================");
  console.log("1. PREPARING 3 NEARBY BIKE DRIVERS (ALL MODELS ON)...");
  console.log("=======================================================");

  // Isolate the test: temporarily take every other online Bike rider offline
  const otherBikeRiders = await prisma.tbl_rider.findMany({
    where: {
      vehicle: "Bike",
      a_status: 1,
      NOT: { vehicle_no: { startsWith: "TEST-3ALL-" } },
    },
    select: { id: true, a_status: true, vehicle_no: true },
  });

  otherRidersBackup = otherBikeRiders;
  if (otherBikeRiders.length > 0) {
    console.log(`Temporarily setting ${otherBikeRiders.length} non-test online bike rider(s) to offline (a_status=0)...`);
    await prisma.tbl_rider.updateMany({
      where: { id: { in: otherBikeRiders.map((r) => r.id) } },
      data: { a_status: 0 },
    });
  }

  // 3 drivers at increasing distances from the customer: ~0.33km, ~0.66km, ~1.0km
  testRiders = [];
  for (let i = 1; i <= 3; i++) {
    const vehicleNo = `TEST-3ALL-${pad2(i)}`;
    const lat = BASE_LAT + (i * 0.003);
    const lng = BASE_LNG;

    let rider = await prisma.tbl_rider.findFirst({ where: { vehicle_no: vehicleNo } });

    if (!rider) {
      rider = await prisma.tbl_rider.create({
        data: {
          first_name: `Sim Bike`,
          last_name: pad2(i),
          fmobile: String(9999970000 + i),
          vehicle: "Bike",
          vehicle_no: vehicleNo,
          a_status: 1,
          status: 1,
          city_id: 1,
          rlats: lat.toFixed(7),
          rlongs: lng.toFixed(7),
          profile_picture: "",
          fcm_token: "",
          device_id: `sim-${vehicleNo}`,
          rdate: new Date(),
        },
      });
      console.log(`Created new rider ${vehicleNo} (ID: ${rider.id})`);
    } else {
      rider = await prisma.tbl_rider.update({
        where: { id: rider.id },
        data: {
          a_status: 1,
          status: 1,
          city_id: 1,
          rlats: lat.toFixed(7),
          rlongs: lng.toFixed(7),
          model1_suspended_until: null,
          model1_miss_streak: 0,
        },
      });
    }

    testRiders.push(rider);

    // ALL 3 drivers: ALL 5 models ON
    for (const pkgId of BIKE_PACKAGE_IDS) {
      const existing = await prisma.tbl_rider_delivery_type.findFirst({
        where: { rider_id: rider.id, delivery_type: String(pkgId) },
      });
      if (existing) {
        if (existing.status !== 1) {
          await prisma.tbl_rider_delivery_type.update({
            where: { id: existing.id },
            data: { status: 1 },
          });
        }
      } else {
        await prisma.tbl_rider_delivery_type.create({
          data: {
            rider_id: rider.id,
            delivery_type: String(pkgId),
            status: 1,
          },
        });
      }
    }
  }

  console.log(`✓ 3 Bike drivers configured, all with Model 1, 2, 3, 4, 5 all ON:`);
  testRiders.forEach((r, idx) => {
    const distKm = ((idx + 1) * 0.003 * 111).toFixed(2); // ~111km per degree latitude
    console.log(`  - Driver #${pad2(idx + 1)} (${r.vehicle_no}, ID ${r.id}) ~${distKm}km from customer`);
  });
}

async function startServer() {
  console.log("\n=======================================================");
  console.log(`2. STARTING SERVER ON PORT ${TEST_PORT}...`);
  console.log("=======================================================");

  serverInstance = http.createServer(app);
  initSocket(serverInstance);

  await new Promise((resolve) => {
    serverInstance.listen(TEST_PORT, () => {
      console.log(`✓ Server running at http://localhost:${TEST_PORT}`);
      resolve();
    });
  });
}

async function connect3DriverSockets(eventsMap) {
  console.log("\n=======================================================");
  console.log("3. CONNECTING 3 DRIVERS VIA WEBSOCKETS (Socket.IO)...");
  console.log("=======================================================");

  sockets = [];
  const connectionPromises = testRiders.map((rider, index) => {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://localhost:${TEST_PORT}`, {
        transports: ["websocket"],
        reconnection: false,
      });

      socket.on("connect", () => {
        socket.emit("driver:join", { rider_id: rider.id });
        resolve(socket);
      });

      socket.on("connect_error", (err) => {
        reject(err);
      });

      socket.on("order:request", (payload) => {
        const arrivalTime = Date.now();
        const record = {
          riderIndex: index + 1,
          riderId: rider.id,
          vehicleNo: rider.vehicle_no,
          packageId: Number(payload.package_id),
          arrivalTime,
          popupDurationSec: Number(payload.popup_duration),
          dismissTime: null,
          dismissReason: null,
        };
        eventsMap.requests.push(record);

        const deltaSeconds = ((arrivalTime - eventsMap.orderCreatedTime) / 1000).toFixed(2);
        console.log(
          `🔔 [POPUP SHOWN] Driver #${pad2(index + 1)} (${rider.vehicle_no}) ` +
          `-> ${PACKAGE_NAMES[payload.package_id] || payload.package_id} popup appears at +${deltaSeconds}s ` +
          `(will stay up to ${payload.popup_duration}s | Fare: Rs.${payload.driver_earning})`
        );
      });

      socket.on("order:dismiss", (payload) => {
        const dismissTime = Date.now();
        const deltaSeconds = ((dismissTime - eventsMap.orderCreatedTime) / 1000).toFixed(2);

        // Match to the most recent still-open request record for this rider
        const openRecord = [...eventsMap.requests]
          .reverse()
          .find((r) => r.riderId === rider.id && r.dismissTime === null);
        if (openRecord) {
          openRecord.dismissTime = dismissTime;
          openRecord.dismissReason = payload.reason;
        }

        console.log(
          `⏱️ [POPUP CLOSED] Driver #${pad2(index + 1)} (${rider.vehicle_no}) ` +
          `popup closed (${payload.reason}) at +${deltaSeconds}s` +
          (openRecord ? ` -> stayed on screen for ${(((dismissTime - openRecord.arrivalTime) / 1000).toFixed(2))}s` : "")
        );
      });

      sockets.push(socket);
    });
  });

  await Promise.all(connectionPromises);
  console.log(`✓ All 3 driver sockets connected and registered in rooms driver_<id>`);
}

async function placeBikeOrder(eventsMap) {
  console.log("\n=======================================================");
  console.log("4. CUSTOMER PLACING 1 BIKE ORDER (ALL 5 MODELS ALLOWED)...");
  console.log("=======================================================");

  const orderPayload = {
    uid: 1,
    category: "Bike",
    delivery_type: BIKE_PACKAGE_IDS, // [6, 7, 21, 33, 34]
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
  console.log(`Dispatching POST /api/order/create at T = 0ms...`);

  const response = await fetch(`http://localhost:${TEST_PORT}/api/order/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderPayload),
  });

  const resJson = await response.json();
  console.log("Order creation response:", resJson);

  if (resJson.Result !== "true" && resJson.Result !== true) {
    throw new Error(`Failed to create order: ${JSON.stringify(resJson)}`);
  }

  createdOrderId = resJson.order_id;
  console.log(`✓ Order #${createdOrderId} created successfully! Watching dispatch cascade live...\n`);
}

function printSummaryTable(eventsMap) {
  console.log("\n=========================================================================================================");
  console.log("📊 3 DRIVERS (ALL MODELS ON) DISPATCH NOTIFICATION TIMELINE REPORT");
  console.log("=========================================================================================================");

  const sorted = [...eventsMap.requests].sort((a, b) => a.arrivalTime - b.arrivalTime);

  const rows = sorted.map((r) => {
    const showAt = ((r.arrivalTime - eventsMap.orderCreatedTime) / 1000).toFixed(2);
    const closedAt = r.dismissTime ? ((r.dismissTime - eventsMap.orderCreatedTime) / 1000).toFixed(2) : null;
    const onScreenFor = r.dismissTime ? ((r.dismissTime - r.arrivalTime) / 1000).toFixed(2) : null;

    return {
      "Driver #": `#${pad2(r.riderIndex)}`,
      "Vehicle No": r.vehicleNo,
      "Model Tier": PACKAGE_NAMES[r.packageId] || r.packageId,
      "Popup Shown At": `+${showAt}s`,
      "Popup Closed At": closedAt ? `+${closedAt}s` : "Still open / order ended",
      "Time On Screen": onScreenFor ? `${onScreenFor}s` : `up to ${r.popupDurationSec}s (not observed)`,
      "Close Reason": r.dismissReason || "-",
    };
  });

  console.table(rows);
  console.log("=========================================================================================================\n");
}

async function cleanup() {
  console.log("\n=======================================================");
  console.log("5. CLEANING UP TEST DATA & SHUTTING DOWN...");
  console.log("=======================================================");

  if (createdOrderId) {
    try {
      const dispatchManager = require("../src/services/dispatchManager");
      dispatchManager.stopDispatch(createdOrderId, "cancelled_by_user");
    } catch (e) { }
  }

  for (const socket of sockets) {
    try {
      socket.disconnect();
    } catch (e) { }
  }

  if (otherRidersBackup.length > 0) {
    console.log(`Restoring ${otherRidersBackup.length} backup bike riders to online...`);
    try {
      await prisma.tbl_rider.updateMany({
        where: { id: { in: otherRidersBackup.map((r) => r.id) } },
        data: { a_status: 1 },
      });
    } catch (e) { }
  }

  if (createdOrderId) {
    console.log(`Cleaning up test order #${createdOrderId}...`);
    try {
      await prisma.tbl_order_requests.deleteMany({ where: { order_id: createdOrderId } });
      await prisma.pkg_order.delete({ where: { id: createdOrderId } });
      console.log(`✓ Test order #${createdOrderId} deleted.`);
    } catch (err) {
      console.warn("Order cleanup warning:", err.message);
    }
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
  };

  // 5 tiers max, each holds a popup up to 15s + ~3s gap between tiers = ~90s worst case
  const MAX_WAIT_MS = 100000;

  try {
    await prepare3Drivers();
    await startServer();
    await connect3DriverSockets(eventsMap);
    await placeBikeOrder(eventsMap);

    console.log(`Watching full dispatch cascade across all 5 model tiers (up to ${MAX_WAIT_MS / 1000}s, since no driver will accept)...`);
    const startTime = Date.now();
    let lastLoggedCount = 0;
    while (Date.now() - startTime < MAX_WAIT_MS) {
      if (eventsMap.requests.length !== lastLoggedCount) {
        lastLoggedCount = eventsMap.requests.length;
      }
      // stop early once 5 tiers x 3 drivers = 15 requests all seen and all closed
      const allClosed = eventsMap.requests.length >= 15 && eventsMap.requests.every((r) => r.dismissTime !== null);
      if (allClosed) break;
      await sleep(500);
    }
    await sleep(1500);

    printSummaryTable(eventsMap);
  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await cleanup();
  }
}

main();
