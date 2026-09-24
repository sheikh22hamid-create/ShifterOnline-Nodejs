async function main() {
  console.log("=== STEP 1: Reading Driver 1 (9999900001) real current GPS fix ===");
  const testDriversRes = await fetch('https://dev-api.shifteronline.com/api/rider/test-drivers');
  const testDriversData = await testDriversRes.json();
  const driver1 = testDriversData.drivers.find(d => d.id === 1);

  console.log("Driver 1 live data:", {
    id: driver1.id,
    name: driver1.name,
    mobile: driver1.mobile,
    vehicle: driver1.vehicle,
    online: driver1.online,
    lat: driver1.lat,
    lng: driver1.lng,
  });

  const driverLat = Number(driver1.lat);
  const driverLng = Number(driver1.lng);

  // If driver goes offline or timestamp needs refresh:
  await fetch('https://dev-api.shifteronline.com/api/rider/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rider_id: 1, a_status: 1 })
  });

  console.log("\n=== STEP 2: Creating order with pickup right next to driver (distance ~50m) ===");
  const pickupLat = driverLat + 0.0003; // ~30 meters away
  const pickupLng = driverLng + 0.0003;
  const dropLat = driverLat + 0.0150;   // ~1.6 km away
  const dropLng = driverLng + 0.0100;

  const payload = {
    uid: 12,
    category: 'Bike',
    delivery_type: [3, 4, 5, 6, 7],
    booking_type: 1,
    plat: pickupLat,
    plong: pickupLng,
    paddress: 'Pickup Near Driver Location (Suket)',
    pick_name: 'Shifter Customer',
    pmobile: '6378211202',
    pick_type: 'Current Location',
    dlat: dropLat,
    dlong: dropLng,
    daddress: 'Drop Location (Main Road, Suket)',
    drop_name: 'Recipient',
    dmobile: '6378211202',
    drop_type: 'Home',
    package_weight: '0',
    package_cost: '0',
    description: 'Live test popup for Driver 9999900001',
    p_method_id: 1,
    transaction_id: 'cash_' + Date.now(),
    extra_mile_charge: 0,
    radius_km: 5
  };

  const createRes = await fetch('https://dev-api.shifteronline.com/api/order/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const createData = await createRes.json();
  console.log("Order Creation Response:", createData);

  const orderId = createData.order_id;
  if (!orderId) {
    console.error("Order creation failed!");
    return;
  }

  console.log(`\n=== STEP 3: Order #${orderId} created! Monitoring live popup offer to Driver 1... ===`);
  console.log(">> DRIVER PHONE SCREEN CHECK KARO - POPUP AAYA HOGA! <<\n");

  for (let i = 1; i <= 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const detRes = await fetch('https://dev-api.shifteronline.com/api/order/details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, uid: 12 })
    });
    const det = await detRes.json();
    const product = det?.OrderProductList?.[0];
    console.log(`[T+${i * 2}s] Status: ${product?.Order_Status} | Assigned Rider: ${product?.rider_id ? (product?.rider_id + ' - ' + product?.rider_name) : 'Searching/Ringing...'}`);
    if (product?.Order_Status === 'Ongoing' || product?.rider_id > 0) {
      console.log(`\n🎉 DRIVER NE ORDER ACCEPT KAR LIYA HAI! Rider ID: ${product?.rider_id}`);
      break;
    }
    if (product?.Order_Status === 'Cancelled') {
      console.log(`\nOrder finished cascade / timed out: ${product?.Order_Status}`);
      break;
    }
  }
}

main().catch(console.error);
