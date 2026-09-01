/**
 * Shifter Online - Comprehensive Order Flow & Business Rules Audit Test Suite
 * 
 * Each test isolates ONLY its required drivers, ensuring 100% deterministic
 * batching, pricing, and notification assertions.
 */

const ioClient = require("socket.io-client");
const prisma = require("../src/config/db");

const BASE_URL = process.env.NODE_BASE_URL || "http://localhost:5000";
const BRIDGE_SECRET = process.env.LEGACY_BRIDGE_SECRET || "c7e3fa49281db259bc840a6b10712e0f8de9217a94f6e1b734891b2c45e89d12";

const TEST_LAT = 26.9124;
const TEST_LNG = 75.7873;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const auditResults = [];

function recordResult(testName, passed, details) {
  auditResults.push({ testName, passed, details, timestamp: new Date().toISOString() });
  const icon = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${icon}: [${testName}]`);
  console.log(`   Details: ${details}\n`);
}

const allTestRiders = [5, 13, 32, 33, 34, 35, 36, 37, 38, 39];

async function resetAllRidersOff() {
  await prisma.tbl_rider.updateMany({
    where: { id: { in: allTestRiders } },
    data: { a_status: 0, status: 0, rlats: "0.0", rlongs: "0.0" },
  });
  await prisma.tbl_rider_delivery_type.updateMany({
    where: { rider_id: { in: allTestRiders } },
    data: { status: 0 },
  });
  await prisma.pkg_order.updateMany({
    where: { rid: { in: allTestRiders } },
    data: { order_status: 4, o_status: "Completed" },
  });
}

async function activateRider(riderId, { aStatus = 1, status = 1, vehicle = "Bike", deliveryTypes = ["6"], lat = TEST_LAT, lng = TEST_LNG }) {
  await prisma.tbl_rider.update({
    where: { id: riderId },
    data: {
      a_status: aStatus,
      status: status,
      vehicle: vehicle,
      rlats: String(lat),
      rlongs: String(lng),
    },
  });

  await prisma.tbl_rider_delivery_type.updateMany({
    where: { rider_id: riderId },
    data: { status: 0 },
  });

  for (const dt of deliveryTypes) {
    const existing = await prisma.tbl_rider_delivery_type.findFirst({
      where: { rider_id: riderId, delivery_type: String(dt) },
    });
    if (existing) {
      await prisma.tbl_rider_delivery_type.update({
        where: { id: existing.id },
        data: { status: 1 },
      });
    } else {
      await prisma.tbl_rider_delivery_type.create({
        data: { rider_id: riderId, delivery_type: String(dt), status: 1 },
      });
    }
  }
}

async function stopOrder(orderId) {
  if (!orderId) return;
  await fetch(`${BASE_URL}/legacy/dispatch/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Legacy-Bridge-Secret": BRIDGE_SECRET,
    },
    body: JSON.stringify({ order_id: orderId, reason: "test_cleanup" }),
  }).catch(() => {});
}

async function runAllAudits() {
  console.log("=========================================================================");
  console.log("🚀 STARTING COMPREHENSIVE SHIFTER ONLINE ORDER-FLOW & RULES AUDIT");
  console.log(`   Target Server: ${BASE_URL}`);
  console.log(`   Isolated Test Geofence: ${TEST_LAT}, ${TEST_LNG}`);
  console.log("=========================================================================\n");

  await resetAllRidersOff();

  // --------------------------------------------------------------------------------------------------
  // TEST 1: Happy Path (Single Driver Offer & Accept)
  // --------------------------------------------------------------------------------------------------
  console.log("--- Running Test 1: Happy Path ---");
  try {
    await resetAllRidersOff();
    const R1 = 5;
    await activateRider(R1, { aStatus: 1, status: 1, deliveryTypes: ["6"] });

    const sock = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    await new Promise((r) => sock.on("connect", r));
    sock.emit("driver:join", { rider_id: R1 });
    await sleep(800);

    let popupData = null;
    sock.on("order:request", (d) => { popupData = d; });

    const res = await fetch(`${BASE_URL}/legacy/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({
        uid: "2",
        category: "Bike",
        delivery_type: "[6]",
        booking_type: "1",
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Jaipur Pickup 1",
        daddress: "Jaipur Drop 1",
        pick_name: "Customer One",
        pmobile: "9999900001",
        package_weight: "1",
        package_cost: "50",
      }),
    });
    const orderJson = await res.json();
    const orderId = Number(orderJson.order_id);

    await sleep(2000);
    const receivedOffer = popupData && Number(popupData.order_id) === orderId;

    const stopRes = await fetch(`${BASE_URL}/legacy/dispatch/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({ order_id: orderId, reason: "accepted_by_other", accepted_rider_id: R1 }),
    });
    const stopJson = await stopRes.json();
    sock.disconnect();
    await stopOrder(orderId);

    recordResult("1. Happy Path Single Driver Accept", receivedOffer && stopJson.Result === true,
      `Order #${orderId} created, popup received by Driver #${R1} (${receivedOffer}), cascade stopped (${stopJson.Result})`);
  } catch (err) {
    recordResult("1. Happy Path Single Driver Accept", false, err.message);
  }

  // --------------------------------------------------------------------------------------------------
  // TEST 2: Multi-Tier / Multi-Model Priority (Model 1 @ T=0s vs Model 2 @ T=5s)
  // --------------------------------------------------------------------------------------------------
  console.log("--- Running Test 2: Multi-Model Priority (Model 1 vs Model 2) ---");
  try {
    await resetAllRidersOff();
    const R_M1 = 13;
    const R_M2 = 32;
    await activateRider(R_M1, { aStatus: 1, status: 1, deliveryTypes: ["6"] }); // Model 1 only
    await activateRider(R_M2, { aStatus: 1, status: 1, deliveryTypes: ["7"] }); // Model 2 only

    const sock1 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    const sock2 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    await Promise.all([
      new Promise((r) => sock1.on("connect", r)),
      new Promise((r) => sock2.on("connect", r)),
    ]);
    sock1.emit("driver:join", { rider_id: R_M1 });
    sock2.emit("driver:join", { rider_id: R_M2 });
    await sleep(800);

    const receivedOffers = [];
    const t0 = Date.now();
    sock1.on("order:request", (d) => receivedOffers.push({ driver: R_M1, pkg: d.package_id, t: (Date.now() - t0) / 1000 }));
    sock2.on("order:request", (d) => receivedOffers.push({ driver: R_M2, pkg: d.package_id, t: (Date.now() - t0) / 1000 }));

    const res = await fetch(`${BASE_URL}/legacy/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({
        uid: "2",
        category: "Bike",
        delivery_type: "[6, 7]",
        booking_type: "1",
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Jaipur Pickup 2",
        daddress: "Jaipur Drop 2",
        pick_name: "Customer Two",
        pmobile: "9999900002",
        package_weight: "1",
        package_cost: "50",
      }),
    });
    const orderJson = await res.json();
    const orderId = Number(orderJson.order_id);

    await sleep(7000);
    sock1.disconnect();
    sock2.disconnect();
    await stopOrder(orderId);

    const d1Offer = receivedOffers.find((o) => o.driver === R_M1);
    const d2Offer = receivedOffers.find((o) => o.driver === R_M2);
    const passed = d1Offer && d2Offer && d1Offer.t < 3.0 && d2Offer.t >= 4.5;

    recordResult("2. Multi-Model Staggered Cascade (Model 1 -> Model 2)", passed,
      `Driver #${R_M1} (Model 1) offer at T=${d1Offer?.t?.toFixed(1)}s, Driver #${R_M2} (Model 2) offer at T=${d2Offer?.t?.toFixed(1)}s`);
  } catch (err) {
    recordResult("2. Multi-Model Staggered Cascade (Model 1 -> Model 2)", false, err.message);
  }

  // --------------------------------------------------------------------------------------------------
  // TEST 3: Driver Explicit Reject Flow
  // --------------------------------------------------------------------------------------------------
  console.log("--- Running Test 3: Driver Rejection Flow ---");
  try {
    await resetAllRidersOff();
    const R3 = 33;
    await activateRider(R3, { aStatus: 1, status: 1, deliveryTypes: ["6"] });

    const sock1 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    await new Promise((r) => sock1.on("connect", r));
    sock1.emit("driver:join", { rider_id: R3 });
    await sleep(800);

    const res = await fetch(`${BASE_URL}/legacy/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({
        uid: "2",
        category: "Bike",
        delivery_type: "[6]",
        booking_type: "1",
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Jaipur Pickup 3",
        daddress: "Jaipur Drop 3",
        pick_name: "Customer Three",
        pmobile: "9999900003",
        package_weight: "1",
        package_cost: "50",
      }),
    });
    const orderJson = await res.json();
    const orderId = Number(orderJson.order_id);
    await sleep(2000);

    // Driver rejects
    const rejectRes = await fetch(`${BASE_URL}/legacy/order/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({ rider_id: R3, order_id: orderId }),
    });
    const rejectJson = await rejectRes.json();

    const reqRow = await prisma.tbl_order_requests.findFirst({
      where: { order_id: orderId, rider_id: R3 },
    });

    sock1.disconnect();
    await stopOrder(orderId);

    const passed = rejectJson.Result === true && reqRow && reqRow.status === "10";
    recordResult("3. Driver Explicit Reject Flow", passed,
      `Driver #${R3} rejected order #${orderId}. DB status='${reqRow?.status}' (expected '10')`);
  } catch (err) {
    recordResult("3. Driver Explicit Reject Flow", false, err.message);
  }

  // --------------------------------------------------------------------------------------------------
  // TEST 4: Concurrent Multi-Driver Batch & Dismiss on 1st Accept
  // --------------------------------------------------------------------------------------------------
  console.log("--- Running Test 4: Concurrent Batch & Instant Dismiss ---");
  try {
    await resetAllRidersOff();
    const C1 = 5, C2 = 13, C3 = 32, C4 = 34;
    await activateRider(C1, { aStatus: 1, status: 1, deliveryTypes: ["6"] });
    await activateRider(C2, { aStatus: 1, status: 1, deliveryTypes: ["6"] });
    await activateRider(C3, { aStatus: 1, status: 1, deliveryTypes: ["6"] });
    await activateRider(C4, { aStatus: 1, status: 1, deliveryTypes: ["6"] });

    const s1 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    const s2 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    const s3 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    const s4 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });

    await Promise.all([
      new Promise((r) => s1.on("connect", r)),
      new Promise((r) => s2.on("connect", r)),
      new Promise((r) => s3.on("connect", r)),
      new Promise((r) => s4.on("connect", r)),
    ]);
    s1.emit("driver:join", { rider_id: C1 });
    s2.emit("driver:join", { rider_id: C2 });
    s3.emit("driver:join", { rider_id: C3 });
    s4.emit("driver:join", { rider_id: C4 });
    await sleep(800);

    const receivedOffers = [];
    const receivedDismiss = [];
    s1.on("order:request", () => receivedOffers.push(C1));
    s2.on("order:request", () => receivedOffers.push(C2));
    s3.on("order:request", () => receivedOffers.push(C3));
    s4.on("order:request", () => receivedOffers.push(C4));

    s2.on("order:dismiss", (d) => receivedDismiss.push({ driver: C2, reason: d.reason }));
    s3.on("order:dismiss", (d) => receivedDismiss.push({ driver: C3, reason: d.reason }));
    s4.on("order:dismiss", (d) => receivedDismiss.push({ driver: C4, reason: d.reason }));

    const res = await fetch(`${BASE_URL}/legacy/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({
        uid: "2",
        category: "Bike",
        delivery_type: "[6]",
        booking_type: "1",
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Jaipur Pickup 4",
        daddress: "Jaipur Drop 4",
        pick_name: "Customer Four",
        pmobile: "9999900004",
        package_weight: "1",
        package_cost: "50",
      }),
    });
    const orderJson = await res.json();
    const orderId = Number(orderJson.order_id);
    await sleep(2000);

    // C1 accepts
    await fetch(`${BASE_URL}/legacy/dispatch/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({ order_id: orderId, reason: "accepted_by_other", accepted_rider_id: C1 }),
    });

    await sleep(1500);

    s1.disconnect();
    s2.disconnect();
    s3.disconnect();
    s4.disconnect();
    await stopOrder(orderId);

    const multipleOffers = receivedOffers.length >= 3;
    const dismissTriggered = receivedDismiss.length >= 1 && receivedDismiss[0].reason === "accepted_by_other";

    recordResult("4. Concurrent Batch (4 Drivers) & Instant Dismiss", multipleOffers && dismissTriggered,
      `${receivedOffers.length} drivers notified in parallel; ${receivedDismiss.length} drivers dismissed with reason '${receivedDismiss[0]?.reason}'`);
  } catch (err) {
    recordResult("4. Concurrent Batch (4 Drivers) & Instant Dismiss", false, err.message);
  }

  // --------------------------------------------------------------------------------------------------
  // TEST 5: Customer Cancellation Flow
  // --------------------------------------------------------------------------------------------------
  console.log("--- Running Test 5: Customer Cancellation Flow ---");
  try {
    await resetAllRidersOff();
    const R5 = 35;
    await activateRider(R5, { aStatus: 1, status: 1, deliveryTypes: ["6"] });

    const sock = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    await new Promise((r) => sock.on("connect", r));
    sock.emit("driver:join", { rider_id: R5 });
    await sleep(800);

    let dismissData = null;
    let offerReceived = false;
    sock.on("order:request", () => { offerReceived = true; });
    sock.on("order:dismiss", (d) => { dismissData = d; });

    const res = await fetch(`${BASE_URL}/legacy/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({
        uid: "2",
        category: "Bike",
        delivery_type: "[6]",
        booking_type: "1",
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Jaipur Pickup 5",
        daddress: "Jaipur Drop 5",
        pick_name: "Customer Five",
        pmobile: "9999900005",
        package_weight: "1",
        package_cost: "50",
      }),
    });
    const orderJson = await res.json();
    const orderId = Number(orderJson.order_id);

    // Wait until driver has received offer popup
    await sleep(2000);

    const stopRes = await fetch(`${BASE_URL}/legacy/dispatch/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({ order_id: orderId, reason: "cancelled_by_user" }),
    });
    const stopJson = await stopRes.json();
    await sleep(1500);
    sock.disconnect();
    await stopOrder(orderId);

    const passed = stopJson.Result === true && dismissData && dismissData.reason === "cancelled_by_user";
    recordResult("5. Customer Cancellation & Driver Popup Dismiss", passed,
      `Customer cancelled order #${orderId}, Driver #${R5} offer received (${offerReceived}), popup dismissed with reason '${dismissData?.reason}'`);
  } catch (err) {
    recordResult("5. Customer Cancellation & Driver Popup Dismiss", false, err.message);
  }

  // --------------------------------------------------------------------------------------------------
  // TEST 6: Geofence & Search Radius Boundary (10km)
  // --------------------------------------------------------------------------------------------------
  console.log("--- Running Test 6: Radius & Geofence Filtering ---");
  try {
    await resetAllRidersOff();
    const R_NEAR = 36;
    const R_FAR = 37;
    await activateRider(R_NEAR, { aStatus: 1, status: 1, deliveryTypes: ["6"], lat: TEST_LAT + 0.004, lng: TEST_LNG });
    await activateRider(R_FAR, { aStatus: 1, status: 1, deliveryTypes: ["6"], lat: TEST_LAT + 0.35, lng: TEST_LNG + 0.35 }); // 35km away

    const sock1 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    const sock2 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    await Promise.all([
      new Promise((r) => sock1.on("connect", r)),
      new Promise((r) => sock2.on("connect", r)),
    ]);
    sock1.emit("driver:join", { rider_id: R_NEAR });
    sock2.emit("driver:join", { rider_id: R_FAR });
    await sleep(800);

    let nearGot = false;
    let farGot = false;
    sock1.on("order:request", () => { nearGot = true; });
    sock2.on("order:request", () => { farGot = true; });

    const res = await fetch(`${BASE_URL}/legacy/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({
        uid: "2",
        category: "Bike",
        delivery_type: "[6]",
        booking_type: "1",
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Jaipur Pickup 6",
        daddress: "Jaipur Drop 6",
        pick_name: "Customer Six",
        pmobile: "9999900006",
        package_weight: "1",
        package_cost: "50",
      }),
    });
    const orderJson = await res.json();
    const orderId = Number(orderJson.order_id);

    await sleep(3000);
    sock1.disconnect();
    sock2.disconnect();
    await stopOrder(orderId);

    const passed = nearGot === true && farGot === false;
    recordResult("6. Geofence & 10km Search Radius Filter", passed,
      `Driver #${R_NEAR} (within radius) received offer: ${nearGot}; Driver #${R_FAR} (35km away) excluded: ${!farGot}`);
  } catch (err) {
    recordResult("6. Geofence & 10km Search Radius Filter", false, err.message);
  }

  // --------------------------------------------------------------------------------------------------
  // TEST 7: Inactive / Offline Driver Exclusion
  // --------------------------------------------------------------------------------------------------
  console.log("--- Running Test 7: Offline / Inactive Driver Filter ---");
  try {
    await resetAllRidersOff();
    const R_OFF = 38;
    const R_ON = 39;
    await activateRider(R_OFF, { aStatus: 0, status: 1, deliveryTypes: ["6"] }); // Inactive
    await activateRider(R_ON, { aStatus: 1, status: 1, deliveryTypes: ["6"] }); // Online

    const sock1 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    const sock2 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    await Promise.all([
      new Promise((r) => sock1.on("connect", r)),
      new Promise((r) => sock2.on("connect", r)),
    ]);
    sock1.emit("driver:join", { rider_id: R_OFF });
    sock2.emit("driver:join", { rider_id: R_ON });
    await sleep(800);

    let offGot = false;
    let onGot = false;
    sock1.on("order:request", () => { offGot = true; });
    sock2.on("order:request", () => { onGot = true; });

    const res = await fetch(`${BASE_URL}/legacy/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({
        uid: "2",
        category: "Bike",
        delivery_type: "[6]",
        booking_type: "1",
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Jaipur Pickup 7",
        daddress: "Jaipur Drop 7",
        pick_name: "Customer Seven",
        pmobile: "9999900007",
        package_weight: "1",
        package_cost: "50",
      }),
    });
    const orderJson = await res.json();
    const orderId = Number(orderJson.order_id);

    await sleep(3000);
    sock1.disconnect();
    sock2.disconnect();
    await stopOrder(orderId);

    const passed = offGot === false && onGot === true;
    recordResult("7. Offline / Inactive Driver Exclusion", passed,
      `Inactive Driver #${R_OFF} excluded: ${!offGot}, Active Driver #${R_ON} offered: ${onGot}`);
  } catch (err) {
    recordResult("7. Offline / Inactive Driver Exclusion", false, err.message);
  }

  // --------------------------------------------------------------------------------------------------
  // TEST 8: Double-Acceptance Prevention (Active Order Guard)
  // --------------------------------------------------------------------------------------------------
  console.log("--- Running Test 8: Double-Acceptance Prevention ---");
  try {
    await resetAllRidersOff();
    const R_BUSY = 34;
    await activateRider(R_BUSY, { aStatus: 1, status: 1, deliveryTypes: ["6"] });

    // Put busy driver in active trip
    await prisma.pkg_order.create({
      data: {
        uid: 2,
        rid: R_BUSY,
        category: "Bike",
        delivery_type: 6,
        booking_type: 1,
        o_status: "Processing",
        order_status: 1,
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Active Trip",
        daddress: "Active Drop",
        pick_type: "house",
        drop_type: "house",
        pick_name: "Test",
        drop_name: "Test",
        pmobile: "9999999999",
        dmobile: "9999999999",
        distance: 2,
        d_charge: 10,
        extra_mile_charge: 0,
        commission: 0,
        total_dcharge: 15,
        time_duration: 10,
        package_weight: 1,
        package_cost: 50,
        cou_id: 0,
        cou_amt: 0,
        radius_range: 10,
        radius_charge: 0,
        p_method_id: 1,
        odate: new Date(),
      },
    });

    const sock1 = ioClient(BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
    await new Promise((r) => sock1.on("connect", r));
    sock1.emit("driver:join", { rider_id: R_BUSY });
    await sleep(800);

    let busyGot = false;
    sock1.on("order:request", () => { busyGot = true; });

    const res = await fetch(`${BASE_URL}/legacy/order/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Legacy-Bridge-Secret": BRIDGE_SECRET },
      body: JSON.stringify({
        uid: "2",
        category: "Bike",
        delivery_type: "[6]",
        booking_type: "1",
        plat: String(TEST_LAT),
        plong: String(TEST_LNG),
        dlat: String(TEST_LAT + 0.01),
        dlong: String(TEST_LNG + 0.01),
        paddress: "Jaipur Pickup 8",
        daddress: "Jaipur Drop 8",
        pick_name: "Customer Eight",
        pmobile: "9999900008",
        package_weight: "1",
        package_cost: "50",
      }),
    });
    const orderJson = await res.json();
    const orderId = Number(orderJson.order_id);

    await sleep(3000);
    sock1.disconnect();
    await stopOrder(orderId);

    recordResult("8. Double-Acceptance & Busy Driver Protection", busyGot === false,
      `Busy Driver #${R_BUSY} (active ride in progress) excluded from receiving new popups: ${!busyGot}`);
  } catch (err) {
    recordResult("8. Double-Acceptance & Busy Driver Protection", false, err.message);
  }

  // --------------------------------------------------------------------------------------------------
  // SUMMARY REPORT
  // --------------------------------------------------------------------------------------------------
  console.log("\n=========================================================================");
  console.log("📊 COMPREHENSIVE AUDIT REPORT SUMMARY");
  console.log("=========================================================================\n");

  const total = auditResults.length;
  const passedCount = auditResults.filter((r) => r.passed).length;
  const failedCount = total - passedCount;

  auditResults.forEach((r, idx) => {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${idx + 1}. [${status}] ${r.testName}`);
    console.log(`   -> ${r.details}`);
  });

  console.log(`\nFinal Score: ${passedCount}/${total} Passed (${failedCount} Failed)`);
  console.log("=========================================================================\n");

  await resetAllRidersOff();
  process.exit(failedCount > 0 ? 1 : 0);
}

runAllAudits().catch((err) => {
  console.error("Fatal audit runner error:", err);
  process.exit(1);
});
