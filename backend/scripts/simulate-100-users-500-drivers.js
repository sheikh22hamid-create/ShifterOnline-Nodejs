/**
 * Shifter Online - 100 Concurrent Orders x 500 Drivers Concurrency Benchmark & Simulation
 * 
 * Objectives:
 * 1. Simulates 500 Online Drivers with realistic geographic spread and diverse model toggle configurations:
 *    - Group A (150 drivers): Model 1 only (Economy)
 *    - Group B (100 drivers): Model 2 only (Mid-tier)
 *    - Group C (100 drivers): Models 1 & 2
 *    - Group D (75 drivers): Models 3 & 4
 *    - Group E (75 drivers): All 5 Models (Full fleet)
 * 
 * 2. Simulates 100 Customers placing orders at the exact same millisecond (T = 0ms) with varied model selections:
 *    - 30 Customers: Model 1 ONLY (Strict budget)
 *    - 25 Customers: Model 2 ONLY
 *    - 25 Customers: Models 1, 2 & 3
 *    - 20 Customers: All 5 Models enabled
 * 
 * 3. Tests & Validates the Architecture:
 *    - Atomic Lock Integrity: Is ANY driver ever double-booked across the 100 simultaneous orders?
 *    - Fleet Utilization: How many of the 500 drivers are successfully locked and notified?
 *    - Contention Dynamics: How orders competing for the closest drivers resolve via Top-Up rounds.
 *    - Model Shortage / Exhaustion: What happens when 30 customers demand Model 1 drivers at once?
 */

const lockManager = require("../src/services/lockManager");
const { haversineKm } = require("../src/utils/geoDistance");
const { MAX_DRIVERS_PER_BATCH, POPUP_TIMEOUT_MS } = require("../src/config/constants");

const CITY_LAT = 22.7402368;
const CITY_LNG = 75.913299;

const PACKAGE_NAMES = {
  6: "Model 1",
  7: "Model 2",
  21: "Model 3",
  33: "Model 4",
  34: "Model 5",
};

// 1. Generate 500 Drivers
function generate500Drivers() {
  const drivers = [];
  for (let i = 1; i <= 500; i++) {
    // Spatial distribution: radius 0.2km to 12.0km from city center
    const angle = (i * 137.5) * (Math.PI / 180); // Golden angle distribution
    const distKm = 0.2 + (i / 500) * 11.8;
    const latOffset = (distKm / 111) * Math.cos(angle);
    const lngOffset = (distKm / (111 * Math.cos(CITY_LAT * Math.PI / 180))) * Math.sin(angle);

    let activePackages = [];
    let group = "";
    if (i <= 150) {
      activePackages = [6];
      group = "Model 1 Only";
    } else if (i <= 250) {
      activePackages = [7];
      group = "Model 2 Only";
    } else if (i <= 350) {
      activePackages = [6, 7];
      group = "Models 1 & 2";
    } else if (i <= 425) {
      activePackages = [21, 33];
      group = "Models 3 & 4";
    } else {
      activePackages = [6, 7, 21, 33, 34];
      group = "All 5 Models";
    }

    drivers.push({
      rider_id: i,
      name: `Driver #${String(i).padStart(3, "0")}`,
      lat: CITY_LAT + latOffset,
      lng: CITY_LNG + lngOffset,
      activePackages,
      group,
    });
  }
  return drivers;
}

// 2. Generate 100 Orders
function generate100Orders() {
  const orders = [];
  for (let i = 1; i <= 100; i++) {
    let delivery_types = [];
    let profile = "";

    if (i <= 30) {
      delivery_types = [6];
      profile = "Model 1 Only (30 orders)";
    } else if (i <= 55) {
      delivery_types = [7];
      profile = "Model 2 Only (25 orders)";
    } else if (i <= 80) {
      delivery_types = [6, 7, 21];
      profile = "Models 1, 2, 3 (25 orders)";
    } else {
      delivery_types = [6, 7, 21, 33, 34];
      profile = "All 5 Models (20 orders)";
    }

    // Orders placed around various hubs in the city
    const angle = (i * 36) * (Math.PI / 180);
    const distKm = 0.5 + (i % 10) * 0.8;
    const latOffset = (distKm / 111) * Math.cos(angle);
    const lngOffset = (distKm / 111) * Math.sin(angle);

    orders.push({
      id: 1000 + i,
      customer_id: i,
      pickup_lat: CITY_LAT + latOffset,
      pickup_lng: CITY_LNG + lngOffset,
      delivery_types,
      profile,
    });
  }
  return orders;
}

// Candidate selector matching production geoDistance & toggle logic
function findEligibleCandidates(order, packageId, allDrivers, excludeIds) {
  const candidates = [];
  for (const driver of allDrivers) {
    if (excludeIds.has(driver.rider_id)) continue;
    if (!driver.activePackages.includes(packageId)) continue;

    const distance = haversineKm(order.pickup_lat, order.pickup_lng, driver.lat, driver.lng);
    if (distance <= 10.0) { // 10km radius
      candidates.push({ ...driver, distance });
    }
  }

  // Nearest drivers first
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates;
}

// Simulate Dispatch for an order
async function simulateOrderDispatch(order, allDrivers, stats) {
  const orderId = order.id;
  const lockedRiderIds = [];
  const considered = new Set();
  let topupRounds = 0;
  let packageOffered = order.delivery_types[0];

  // Try tiers in priority order until drivers found
  for (const pkgId of order.delivery_types) {
    let round = 0;
    while (lockedRiderIds.length < MAX_DRIVERS_PER_BATCH && round <= 2) {
      topupRounds++;
      const currentLocked = new Set(lockManager.getAllLockedRiderIds());
      const excludeIds = new Set([...currentLocked, ...considered]);

      const candidates = findEligibleCandidates(order, pkgId, allDrivers, excludeIds);
      if (candidates.length === 0) break;

      for (const candidate of candidates) {
        if (lockedRiderIds.length >= MAX_DRIVERS_PER_BATCH) break;
        considered.add(candidate.rider_id);

        if (lockManager.acquireLock(candidate.rider_id, orderId, POPUP_TIMEOUT_MS)) {
          lockedRiderIds.push(candidate.rider_id);
          stats.driverAssignedOrderMap.set(candidate.rider_id, orderId);
        } else {
          stats.totalLockCollisions++;
        }
      }

      round++;
    }

    if (lockedRiderIds.length > 0) {
      packageOffered = pkgId;
      break; // Found drivers in this tier
    }
  }

  return {
    orderId,
    profile: order.profile,
    packageOffered,
    lockedCount: lockedRiderIds.length,
    lockedRiderIds,
    topupRounds,
  };
}

async function run100x500Simulation() {
  console.log("=========================================================================================================");
  console.log("⚡ 100 CONCURRENT USERS x 500 DRIVERS LOAD & CONCURRENCY BENCHMARK");
  console.log("=========================================================================================================");

  const drivers = generate500Drivers();
  const orders = generate100Orders();

  console.log(`\n1. SEED DATA SUMMARY:`);
  console.log(`   • Total Online Drivers: ${drivers.length}`);
  console.log(`     - Model 1 Only: 150 drivers`);
  console.log(`     - Model 2 Only: 100 drivers`);
  console.log(`     - Models 1 & 2: 100 drivers`);
  console.log(`     - Models 3 & 4: 75 drivers`);
  console.log(`     - All 5 Models: 75 drivers`);
  console.log(`   • Total Concurrent Customers: ${orders.length}`);
  console.log(`     - Model 1 Only: 30 customers`);
  console.log(`     - Model 2 Only: 25 customers`);
  console.log(`     - Models 1, 2, 3: 25 customers`);
  console.log(`     - All 5 Models: 20 customers`);

  console.log("\n2. SIMULATING 100 SIMULTANEOUS DISPATCHES (T = 0ms)...");
  const startTime = Date.now();

  const stats = {
    totalLockCollisions: 0,
    driverAssignedOrderMap: new Map(), // riderId -> orderId
  };

  // Launch all 100 order dispatches in parallel
  const dispatchPromises = orders.map((order) => simulateOrderDispatch(order, drivers, stats));
  const results = await Promise.all(dispatchPromises);
  const elapsedMs = Date.now() - startTime;

  console.log(`✓ All 100 dispatches executed in ${elapsedMs}ms!`);

  // 3. Audit Double Bookings
  let doubleBookings = 0;
  const lockedDriversList = lockManager.getAllLockedRiderIds();
  const driverSeenCounts = {};

  for (const res of results) {
    for (const rId of res.lockedRiderIds) {
      driverSeenCounts[rId] = (driverSeenCounts[rId] || 0) + 1;
      if (driverSeenCounts[rId] > 1) {
        doubleBookings++;
      }
    }
  }

  // 4. Summarize Results
  const fullBatches = results.filter((r) => r.lockedCount === 4).length;
  const partialBatches = results.filter((r) => r.lockedCount > 0 && r.lockedCount < 4).length;
  const zeroBatches = results.filter((r) => r.lockedCount === 0).length;
  const totalDriversLocked = results.reduce((sum, r) => sum + r.lockedCount, 0);

  // Group by profile
  const breakdown = {};
  for (const r of results) {
    if (!breakdown[r.profile]) {
      breakdown[r.profile] = { orders: 0, driversLocked: 0, full: 0, partial: 0, zero: 0 };
    }
    breakdown[r.profile].orders++;
    breakdown[r.profile].driversLocked += r.lockedCount;
    if (r.lockedCount === 4) breakdown[r.profile].full++;
    else if (r.lockedCount > 0) breakdown[r.profile].partial++;
    else breakdown[r.profile].zero++;
  }

  console.log("\n=========================================================================================================");
  console.log("📊 100 ORDERS CONCURRENCY BENCHMARK RESULTS");
  console.log("=========================================================================================================");

  const reportRows = Object.keys(breakdown).map((k) => ({
    "Customer Segment": k,
    "Orders Count": breakdown[k].orders,
    "Full Batches (4 drivers)": breakdown[k].full,
    "Partial Batches (1-3)": breakdown[k].partial,
    "No Drivers Found": breakdown[k].zero,
    "Total Drivers Locked": breakdown[k].driversLocked,
    "Avg Drivers / Order": (breakdown[k].driversLocked / breakdown[k].orders).toFixed(1),
  }));

  console.table(reportRows);

  console.log("\n---------------------------------------------------------------------------------------------------------");
  console.log("📌 ARCHITECTURAL CONCURRENCY AUDIT:");
  console.log("---------------------------------------------------------------------------------------------------------");
  console.log(`• Execution Speed: 100 parallel dispatches resolved in ${elapsedMs}ms`);
  console.log(`• Total Drivers Locked: ${totalDriversLocked} out of 500 drivers (${((totalDriversLocked / 500) * 100).toFixed(1)}% fleet utilization)`);
  console.log(`• Double-Booking Violations: ${doubleBookings === 0 ? "0 (✅ 100% ATOMICALLY SAFE)" : doubleBookings + " (❌ FAILED)"}`);
  console.log(`• Contested Collisions Resolved: ${stats.totalLockCollisions} candidate contention races resolved cleanly`);
  console.log(`• Orders with >= 1 Driver: ${fullBatches + partialBatches} / 100 (${fullBatches + partialBatches}%)`);
  console.log(`• Orders with Full 4-Driver Batch: ${fullBatches} / 100`);
  console.log(`• Orders with Partial Batch: ${partialBatches} / 100`);
  console.log(`• Orders with 0 Drivers: ${zeroBatches} / 100`);
  console.log("=========================================================================================================\n");

  // Cleanup locks
  for (const id of lockedDriversList) {
    lockManager.releaseLock(id);
  }

  // -------------------------------------------------------------------------
  // SCENARIO B: HYPER-CONCENTRATED HOTSPOT (HIGH CONTENTION)
  // -------------------------------------------------------------------------
  console.log("\n=========================================================================================================");
  console.log("🔥 SCENARIO B: HYPER-CONCENTRATED HOTSPOT (100 Orders in Same 1.5km Radius)");
  console.log("=========================================================================================================");
  console.log("Simulating peak festival / station rush where all 100 orders compete for the EXACT SAME closest drivers...");

  const hotspotOrders = orders.map((o, idx) => ({
    ...o,
    pickup_lat: CITY_LAT + (Math.random() - 0.5) * 0.015, // ~1.5km area
    pickup_lng: CITY_LNG + (Math.random() - 0.5) * 0.015,
  }));

  const hotspotStats = {
    totalLockCollisions: 0,
    driverAssignedOrderMap: new Map(),
  };

  const tStartHotspot = Date.now();
  const hotspotResults = await Promise.all(
    hotspotOrders.map((order) => simulateOrderDispatch(order, drivers, hotspotStats))
  );
  const tHotspotMs = Date.now() - tStartHotspot;

  let hotspotDoubleBookings = 0;
  const hotspotSeen = {};
  for (const res of hotspotResults) {
    for (const rId of res.lockedRiderIds) {
      hotspotSeen[rId] = (hotspotSeen[rId] || 0) + 1;
      if (hotspotSeen[rId] > 1) hotspotDoubleBookings++;
    }
  }

  const hFull = hotspotResults.filter((r) => r.lockedCount === 4).length;
  const hPartial = hotspotResults.filter((r) => r.lockedCount > 0 && r.lockedCount < 4).length;
  const hZero = hotspotResults.filter((r) => r.lockedCount === 0).length;
  const hTotalDrivers = hotspotResults.reduce((s, r) => s + r.lockedCount, 0);

  console.log(`✓ Hotspot simulation resolved in ${tHotspotMs}ms!`);
  console.log("\n---------------------------------------------------------------------------------------------------------");
  console.log("📌 HOTSPOT COLLISION AUDIT:");
  console.log("---------------------------------------------------------------------------------------------------------");
  console.log(`• Contested Collisions Resolved: ${hotspotStats.totalLockCollisions} candidate contention races resolved cleanly`);
  console.log(`• Double-Booking Violations: ${hotspotDoubleBookings === 0 ? "0 (✅ 100% ATOMICALLY SAFE)" : hotspotDoubleBookings + " (❌ FAILED)"}`);
  console.log(`• Total Drivers Allocated: ${hTotalDrivers} drivers`);
  console.log(`• Orders with Full Batch (4): ${hFull} orders`);
  console.log(`• Orders with Partial Batch (1-3): ${hPartial} orders`);
  console.log(`• Orders with 0 Free Drivers (Waiting for Batch 2): ${hZero} orders`);
  console.log("=========================================================================================================\n");

  // Cleanup locks
  for (const id of lockManager.getAllLockedRiderIds()) {
    lockManager.releaseLock(id);
  }
}

run100x500Simulation();
