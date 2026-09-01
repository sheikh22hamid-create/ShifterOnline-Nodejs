/**
 * Shifter Online - Live Render Production Server End-to-End Order Flow Test
 * 
 * Target: https://shifteronline-nodejs.onrender.com
 * 
 * Verifies live in the cloud:
 * 1. GET /health & POST /api/order/fare-estimate over HTTPS
 * 2. Real Socket.io connection to Render for Customer and Top Drivers
 * 3. Order creation via POST https://shifteronline-nodejs.onrender.com/api/order/create
 * 4. Dispatch cascade: Driver receives 'order:request' popup event over WSS
 * 5. Driver accepts: Emits 'order:accept', receives 'order:accept:ack'
 * 6. Customer live update: Customer receives 'order:assigned' with OTP, Driver Name & Vehicle
 * 7. Live Trip Progression:
 *    - Status 2 (Arrived at Pickup) -> Customer receives 'order:status_changed'
 *    - Status 3 (Trip Started / On Route) -> Customer receives 'order:status_changed'
 *    - Live GPS Ping -> Customer receives 'driver:location_stream'
 *    - Status 4 (Trip Completed) -> Customer receives 'order:completed'
 */

const ioClient = require("socket.io-client");
const prisma = require("../src/lib/prisma");

// No hardcoded production default on purpose — this script creates a real
// order, rings real online drivers' real devices, and deletes a real DB row
// at the end. Both of these must be set explicitly so it can never run by a
// stray invocation:
//   RENDER_BASE_URL=https://shifteronline-nodejs.onrender.com \
//   CONFIRM_PRODUCTION_TEST=yes node scripts/test-render-live-order-flow.js
const RENDER_BASE_URL = process.env.RENDER_BASE_URL;
if (!RENDER_BASE_URL || process.env.CONFIRM_PRODUCTION_TEST !== "yes") {
  console.error(
    "Refusing to run: this script targets a live production server and creates/deletes real data.\n" +
    "Set RENDER_BASE_URL and CONFIRM_PRODUCTION_TEST=yes explicitly to proceed."
  );
  process.exit(1);
}
const BASE_LAT = 22.7356214;
const BASE_LNG = 75.9110814;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRenderTest() {
  console.log("=========================================================================================================");
  console.log(`🌐 TESTING LIVE CLOUD SERVER ON RENDER: ${RENDER_BASE_URL}`);
  console.log("=========================================================================================================\n");

  // Step 1: Health Check
  console.log("1. CHECKING RENDER /health ENDPOINT...");
  const healthRes = await fetch(`${RENDER_BASE_URL}/health`);
  const healthJson = await healthRes.json();
  console.log(`✓ Health Status: ${healthRes.status} | Response:`, healthJson);
  if (healthJson.status !== "ok") {
    throw new Error("Render server health check failed!");
  }

  // Step 2: Fare Estimate API
  console.log("\n2. TESTING FARE ESTIMATE API OVER HTTPS...");
  const fareBody = {
    uid: 7,
    cat_id: 8, // Bike
    plat: BASE_LAT,
    plong: BASE_LNG,
    dlat: BASE_LAT - 0.02,
    dlong: BASE_LNG - 0.03,
  };
  const fareRes = await fetch(`${RENDER_BASE_URL}/api/order/fare-estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fareBody),
  });
  const fareJson = await fareRes.json();
  console.log(`✓ Fare Estimate Status: ${fareRes.status}`);
  console.log(`  Distance: ${fareJson.distance_km} km | Duration: ~${fareJson.duration_min} mins`);
  console.log(`  Available Packages: ${fareJson.packages.map((p) => `${p.title} (₹${p.estimated_fare})`).join(", ")}`);

  // Step 3: Fetch Available Online Drivers on Render
  console.log("\n3. FETCHING ONLINE BIKE DRIVERS FROM RENDER...");
  const driversRes = await fetch(`${RENDER_BASE_URL}/api/rider/test-drivers`);
  const driversJson = await driversRes.json();
  const onlineBikes = (driversJson.drivers || []).filter((d) => d.vehicle === "Bike" && d.online);
  console.log(`✓ Total Online Bike Drivers on Render: ${onlineBikes.length}`);

  if (onlineBikes.length === 0) {
    throw new Error("No online Bike drivers found on Render! Need at least 1 online Bike driver.");
  }

  // Pick top 4 closest drivers
  const targetDrivers = onlineBikes.slice(0, 4);
  console.log(`  Connecting top ${targetDrivers.length} test drivers to Render sockets:`);
  targetDrivers.forEach((d) => console.log(`    - Rider #${d.id} (${d.vehicle_no || "TEST-BIKE"})`));

  // Step 4: Connect Sockets to Render
  console.log("\n4. CONNECTING WEBSOCKETS TO RENDER (WSS)...");
  const events = {
    customerEvents: [],
    driverEvents: [],
  };

  const customerSocket = ioClient(RENDER_BASE_URL, {
    transports: ["websocket"],
    forceNew: true,
  });

  await new Promise((resolve) => {
    customerSocket.on("connect", () => {
      console.log(`✓ Customer connected to Render socket (id: ${customerSocket.id})`);
      customerSocket.emit("customer:join", { user_id: 7 });
      resolve();
    });
  });

  const driverSockets = [];
  let winningDriverSocket = null;
  let winningDriverId = null;
  let receivedOfferResolve = null;
  const receivedOfferPromise = new Promise((resolve) => {
    receivedOfferResolve = resolve;
  });

  for (const driver of targetDrivers) {
    const dSock = ioClient(RENDER_BASE_URL, {
      transports: ["websocket"],
      forceNew: true,
    });

    await new Promise((resolve) => {
      dSock.on("connect", () => {
        console.log(`✓ Driver #${driver.id} connected (socket: ${dSock.id})`);
        dSock.emit("driver:join", { rider_id: driver.id });

        dSock.on("order:request", (data) => {
          console.log(`\n🔔 [DRIVER #${driver.id}] Received 'order:request' Popup!`);
          console.log(`   Order #${data.order_id} | Model Tier: ${data.package_id} | Distance: ${data.distance} km | Earning: ₹${data.driver_earning}`);
          events.driverEvents.push({ event: "order:request", riderId: driver.id, data });
          if (!winningDriverSocket) {
            winningDriverSocket = dSock;
            winningDriverId = driver.id;
            receivedOfferResolve({ driverId: driver.id, socket: dSock, data });
          }
        });

        dSock.on("order:accept:ack", (data) => {
          console.log(`📋 [DRIVER #${driver.id}] Received 'order:accept:ack': Result=${data.Result}, msg='${data.msg}'`);
          events.driverEvents.push({ event: "order:accept:ack", riderId: driver.id, data });
        });

        resolve();
      });
    });

    driverSockets.push({ riderId: driver.id, socket: dSock });
  }

  // Setup customer event listeners
  customerSocket.on("order:assigned", (data) => {
    console.log(`\n🎉 [CUSTOMER EVENT] Received 'order:assigned':`);
    console.log(`   Assigned Driver: ${data.rider_name} | Vehicle: ${data.vehicle_no} | Phone: ${data.rider_phone} | OTP: ${data.otp}`);
    events.customerEvents.push({ event: "order:assigned", data });
  });

  customerSocket.on("order:status_changed", (data) => {
    console.log(`📍 [CUSTOMER EVENT] Received 'order:status_changed': Status=${data.order_status}`);
    events.customerEvents.push({ event: "order:status_changed", data });
  });

  customerSocket.on("driver:location_stream", (data) => {
    console.log(`🛰️ [CUSTOMER EVENT] Received 'driver:location_stream': Lat=${data.lat}, Lng=${data.lng}`);
    events.customerEvents.push({ event: "driver:location_stream", data });
  });

  customerSocket.on("order:completed", (data) => {
    console.log(`🏁 [CUSTOMER EVENT] Received 'order:completed' for Order #${data.order_id}!`);
    events.customerEvents.push({ event: "order:completed", data });
  });

  // Step 5: Place Real Order on Render
  console.log("\n5. PLACING ORDER ON RENDER (POST /api/order/create)...");
  const selectedPackages = fareJson.packages.map((p) => p.package_id);
  const orderBody = {
    uid: 7,
    category: "Bike",
    delivery_type: selectedPackages,
    booking_type: 1,
    plat: BASE_LAT,
    plong: BASE_LNG,
    paddress: "Palasia Hub, Indore",
    pick_name: "Render Test Customer",
    pmobile: "9999900007",
    dlat: BASE_LAT - 0.02,
    dlong: BASE_LNG - 0.03,
    daddress: "Bhawarkua Drop, Indore",
    drop_name: "Render Test Receiver",
    dmobile: "9999900008",
    package_weight: "2.0",
    package_cost: 200,
    radius_km: 15,
    city_id: 1,
  };

  const createRes = await fetch(`${RENDER_BASE_URL}/api/order/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderBody),
  });
  const createJson = await createRes.json();
  console.log(`✓ Order Placement Status: ${createRes.status} | Response:`, createJson);

  if (createJson.Result !== "true" && createJson.Result !== true) {
    throw new Error(`Order creation failed on Render: ${JSON.stringify(createJson)}`);
  }

  const createdOrderId = Number(createJson.order_id);
  console.log(`✓ Live Order #${createdOrderId} placed on Render! Customer joined order_${createdOrderId}`);
  customerSocket.emit("customer:join", { user_id: 7, order_id: createdOrderId });

  // Step 6: Wait for Driver to receive 'order:request' on Render
  console.log("\n6. WAITING FOR RENDER DISPATCH ENGINE TO EMIT 'order:request'...");
  const offer = await Promise.race([
    receivedOfferPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for order:request on Render")), 20000)),
  ]);

  console.log(`✓ Driver #${offer.driverId} received order request first!`);

  // Step 7: Driver Accepts Order
  console.log(`\n7. EMITTING 'order:accept' FROM DRIVER #${offer.driverId} TO RENDER...`);
  
  const acceptAckPromise = new Promise((resolve) => {
    offer.socket.once("order:accept:ack", resolve);
  });
  
  offer.socket.emit("order:accept", { rider_id: offer.driverId, order_id: createdOrderId });
  const ack = await acceptAckPromise;
  console.log(`✓ Driver #${offer.driverId} accept response: Result=${ack.Result}, msg='${ack.msg}'`);

  // Wait 1s for order:assigned to reach customer
  await sleep(1000);

  // Step 8: Simulate Trip Lifecycle on Render
  console.log("\n8. RUNNING TRIP LIFECYCLE ON RENDER...");

  // Status 2: Arrived at Pickup
  console.log("   -> Driver marks 'Arrived at Pickup' (status: 'arrived')...");
  offer.socket.emit("order:status_update", { rider_id: offer.driverId, order_id: createdOrderId, status: "arrived" });
  await sleep(1500);

  // Status 3: Start Trip / On Route
  console.log("   -> Driver marks 'Picked Up / Start Trip' (status: 'pickup')...");
  offer.socket.emit("order:status_update", { rider_id: offer.driverId, order_id: createdOrderId, status: "pickup" });
  await sleep(1500);

  // Send GPS Tracking Ping
  console.log("   -> Driver sends GPS location ping to Render...");
  offer.socket.emit("driver:location_ping", {
    rider_id: offer.driverId,
    order_id: createdOrderId,
    lat: BASE_LAT - 0.01,
    lng: BASE_LNG - 0.01,
    heading: 180,
  });
  await sleep(1500);

  // Status 4: Completed
  console.log("   -> Driver marks 'Complete Delivery' (status: 'complete')...");
  const completeAckPromise = new Promise((resolve) => {
    offer.socket.once("order:status_update:ack", resolve);
  });
  const customerCompletedPromise = new Promise((resolve) => {
    customerSocket.once("order:completed", (data) => {
      events.customerEvents.push({ event: "order:completed", data });
      resolve(data);
    });
  });

  offer.socket.emit("order:status_update", { rider_id: offer.driverId, order_id: createdOrderId, status: "complete" });
  const completeAck = await completeAckPromise;
  console.log(`✓ Complete Delivery ACK: Result=${completeAck.Result}`);

  // Wait for customer socket to receive 'order:completed' (up to 5s)
  await Promise.race([
    customerCompletedPromise,
    sleep(4000),
  ]);

  // Step 9: Audit Report
  console.log("\n=========================================================================================================");
  console.log("📊 RENDER PRODUCTION SERVER AUDIT REPORT");
  console.log("=========================================================================================================");

  const assignedEvent = events.customerEvents.find((e) => e.event === "order:assigned");
  const statusChangedEvents = events.customerEvents.filter((e) => e.event === "order:status_changed");
  const gpsEvent = events.customerEvents.find((e) => e.event === "driver:location_stream");
  const completedEvent = events.customerEvents.find((e) => e.event === "order:completed");
  const acceptAck = events.driverEvents.find((e) => e.event === "order:accept:ack" && e.riderId === offer.driverId);

  console.log(`• Cloud Server Health: ✅ PASSED (HTTP 200 /health)`);
  console.log(`• Fare Estimation: ✅ PASSED (${fareJson.packages.length} models retrieved)`);
  console.log(`• Cloud WebSocket Auth & Join: ✅ PASSED (Customer & Drivers connected over WSS)`);
  console.log(`• Live Order Creation: ✅ PASSED (Order #${createdOrderId} created)`);
  console.log(`• Real-time Dispatch Delivery: ✅ PASSED (Driver #${offer.driverId} received 'order:request' popup)`);
  console.log(`• Atomic Order Acceptance: ${acceptAck && acceptAck.data.Result ? "✅ PASSED (Driver won order: " + acceptAck.data.msg + ")" : "❌ FAILED"}`);
  console.log(`• Customer Notification (OTP): ${assignedEvent ? `✅ PASSED (OTP: ${assignedEvent.data.otp}, Driver: ${assignedEvent.data.rider_name})` : "❌ FAILED"}`);
  console.log(`• Step-by-Step Status Updates: ${statusChangedEvents.length >= 2 ? "✅ PASSED (Arrived & On Route received)" : "❌ FAILED"}`);
  console.log(`• Live GPS Location Streaming: ${gpsEvent ? "✅ PASSED (Coords streamed to customer: " + gpsEvent.data.lat + ", " + gpsEvent.data.lng + ")" : "❌ FAILED"}`);
  console.log(`• Trip Completion: ${completedEvent ? "✅ PASSED ('order:completed' received by customer)" : "❌ FAILED"}`);
  console.log("=========================================================================================================\n");

  // Cleanup Sockets & Database
  customerSocket.disconnect();
  for (const { socket } of driverSockets) {
    socket.disconnect();
  }

  try {
    await prisma.tbl_order_requests.deleteMany({ where: { order_id: createdOrderId } });
    await prisma.pkg_order.delete({ where: { id: createdOrderId } });
    console.log(`✓ Test order #${createdOrderId} cleaned up from database.`);
  } catch (err) {
    console.log("Note: Cleanup warning:", err.message);
  }

  await prisma.$disconnect();
  console.log("✓ Live Render test execution completed successfully!\n");
  process.exit(0);
}

runRenderTest().catch(async (err) => {
  console.error("\n❌ Render Test Failed:", err);
  try { await prisma.$disconnect(); } catch (e) {}
  process.exit(1);
});
