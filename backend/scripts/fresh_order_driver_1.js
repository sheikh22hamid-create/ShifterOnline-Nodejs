async function main() {
  // 1. Get real coordinates
  const listRes = await fetch('https://dev-api.shifteronline.com/api/rider/test-drivers');
  const listData = await listRes.json();
  const d1 = listData.drivers.find(d => d.id === 1);
  console.log("Driver 1 coordinates:", d1.lat, d1.lng);

  const lat = Number(d1.lat);
  const lng = Number(d1.lng);

  // 2. Call /api/rider/location to make rloc_updated_at 100% FRESH (0 seconds old)
  console.log("Pinging /api/rider/location to stamp fresh rloc_updated_at...");
  const locRes = await fetch('https://dev-api.shifteronline.com/api/rider/location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rider_id: 1,
      lat: lat,
      lng: lng,
      device_id: 'test_device'
    })
  });
  console.log("Location ping response:", await locRes.json());

  // 3. Immediately create order at exact driver coordinates
  console.log("Creating order at exact coordinates...");
  const payload = {
    uid: 12,
    category: 'Bike',
    delivery_type: [3, 4, 5, 6, 7],
    booking_type: 1,
    plat: lat,
    plong: lng,
    paddress: 'Pickup Near Driver Location',
    pick_name: 'Alkaif Customer',
    pmobile: '6378211202',
    pick_type: 'Current Location',
    dlat: lat + 0.01,
    dlong: lng + 0.01,
    daddress: 'Drop Near Driver Location',
    drop_name: 'Recipient',
    dmobile: '6378211202',
    drop_type: 'Home',
    package_weight: '0',
    package_cost: '0',
    description: 'Test popup order for driver 9999900001',
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
  console.log("Order Creation:", createData);

  const orderId = createData.order_id;
  if (orderId) {
    console.log(`\nOrder #${orderId} IS NOW LIVE AND OFFERING TO DRIVER 9999900001!`);
    console.log(`>> DRIVER SCREEN PAR POPUP CHECK KAREIN! <<\n`);

    for (let i = 1; i <= 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const detRes = await fetch('https://dev-api.shifteronline.com/api/order/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, uid: 12 })
      });
      const det = await detRes.json();
      const p = det?.OrderProductList?.[0];
      console.log(`[T+${i * 2}s] Status: ${p?.Order_Status} | Rider: ${p?.rider_id ? (p.rider_id + ' ' + p.rider_name) : 'Ringing driver...'}`);
      if (p?.Order_Status === 'Ongoing' || p?.rider_id > 0) {
        console.log(`\n🎉 DRIVER ACCEPTED! Rider ID: ${p.rider_id}`);
        break;
      }
      if (p?.Order_Status === 'Cancelled') {
        console.log(`\nOrder ended: ${p?.Order_Status}`);
        break;
      }
    }
  }
}

main().catch(console.error);
