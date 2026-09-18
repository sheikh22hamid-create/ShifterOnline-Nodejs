const prisma = require("./src/config/db");
const { RIDER_LOCATION_FRESHNESS_MS } = require("./src/config/constants");

async function check() {
  const rider = await prisma.tbl_rider.findFirst({
    where: { fmobile: "9999900001" },
  });
  console.log("RIDER DATA:", {
    id: rider?.id,
    name: rider?.full_name,
    mobile: rider?.fmobile,
    a_status: rider?.a_status,
    status: rider?.status,
    vehicle: rider?.vehicle,
    rlats: rider?.rlats,
    rlongs: rider?.rlongs,
    rloc_updated_at: rider?.rloc_updated_at,
    now: new Date(),
    diffMinutes: rider?.rloc_updated_at ? (Date.now() - new Date(rider.rloc_updated_at).getTime()) / 60000 : null,
  });

  const addresses = await prisma.tbl_address.findMany({ where: { uid: 1 } });
  console.log("USER 1 ADDRESSES:", addresses);

  // Check recent orders or requests for user 1
  const recentOrders = await prisma.pkg_order.findMany({
    where: { uid: 1 },
    orderBy: { id: "desc" },
    take: 3,
    select: { id: true, plat: true, plong: true, paddress: true, daddress: true, odate: true },
  });
  console.log("USER 1 RECENT ORDERS:", recentOrders);

  // If we test with Khajrana Indore lat/lng (~22.75, ~75.89 or address lat/lng)
  let testLat = 22.7500;
  let testLng = 75.8900;
  if (addresses.length && addresses[0].lat && addresses[0].lng) {
    testLat = Number(addresses[0].lat);
    testLng = Number(addresses[0].lng);
  } else if (recentOrders.length && recentOrders[0].plat && recentOrders[0].plong) {
    testLat = Number(recentOrders[0].plat);
    testLng = Number(recentOrders[0].plong);
  }

  console.log(`\nTesting distance from (${testLat}, ${testLng}) to Rider (${rider.rlats}, ${rider.rlongs}):`);

  const pLat = Number(testLat);
  const pLng = Number(testLng);
  const rLat = Number(rider.rlats);
  const rLng = Number(rider.rlongs);

  // Haversine formula
  const dLat = (rLat - pLat) * Math.PI / 180;
  const dLng = (rLng - pLng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(pLat * Math.PI / 180) * Math.cos(rLat * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distKm = 6371 * c;
  console.log("Direct distance (km):", distKm);

  // Check countNearbyOnlineDrivers
  const freshSince = new Date(Date.now() - RIDER_LOCATION_FRESHNESS_MS);
  console.log("Fresh since:", freshSince, "Rider updated at:", rider.rloc_updated_at);
  console.log("Is location fresh? :", new Date(rider.rloc_updated_at) >= freshSince);

  const queryRows = await prisma.$queryRaw`
    SELECT r.id AS rider_id,
      r.rlats, r.rlongs, r.rloc_updated_at, r.a_status, r.status, r.vehicle,
      (6371 * ACOS(
        LEAST(1, GREATEST(-1,
          COS(RADIANS(${pLat})) * COS(RADIANS(CAST(r.rlats AS DECIMAL(10,6)))) *
          COS(RADIANS(CAST(r.rlongs AS DECIMAL(10,6))) - RADIANS(${pLng})) +
          SIN(RADIANS(${pLat})) * SIN(RADIANS(CAST(r.rlats AS DECIMAL(10,6))))
        ))
      )) AS distance_km
    FROM tbl_rider r
    WHERE r.id = ${rider.id}
  `;
  console.log("Raw SQL on rider:", queryRows);

  await prisma.$disconnect();
}

check().catch(console.error);
