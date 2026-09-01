/**
 * Drives the full create -> driver popup -> accept flow through the PHP
 * URLs (not Node directly), confirming the PHP-to-Node bridge works
 * end-to-end.
 */
const ioClient = require("socket.io-client");

const PHP_BASE_URL = process.env.PHP_BASE_URL || "http://localhost:8080";
const NODE_BASE_URL = process.env.NODE_BASE_URL || "http://localhost:5000";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log(`Connecting a test driver socket to ${NODE_BASE_URL}...`);
  const driverSocket = ioClient(NODE_BASE_URL, { transports: ["polling", "websocket"], forceNew: true });
  const testRiderId = Number(process.env.TEST_RIDER_ID || 5);

  await new Promise((resolve) => driverSocket.on("connect", resolve));
  console.log(`Driver socket connected (ID: ${driverSocket.id}), joining room as rider ${testRiderId}...`);
  driverSocket.emit("driver:join", { rider_id: testRiderId });
  await sleep(1000);

  let expectedOrderId = null;
  let receivedRequest = null;

  const orderRequestPromise = new Promise((resolve) => {
    driverSocket.on("order:request", (data) => {
      console.log(`[Socket Event] 'order:request' received:`, data);
      receivedRequest = data;
      resolve(data);
    });
  });

  console.log(`Placing an order through the PHP URL (${PHP_BASE_URL}/cust_api/pks_order.php)...`);
  const createRes = await fetch(`${PHP_BASE_URL}/cust_api/pks_order.php`, {
    method: "POST",
    body: new URLSearchParams({
      uid: process.env.TEST_UID || "2",
      category: "Bike",
      delivery_type: "[6]",
      booking_type: "1",
      plat: "22.7389681",
      plong: "75.8296089",
      dlat: "22.7489681",
      dlong: "75.8396089",
      paddress: "Test Pickup",
      daddress: "Test Drop",
      pick_name: "Bridge Test",
      pmobile: "9999900000",
      package_weight: "2",
      package_cost: "100",
      size: "0",
    }),
  });
  const createJson = await createRes.json();
  console.log("PHP create-order response:", createJson);

  if (createJson.Result !== "true" && createJson.Result !== true) {
    throw new Error("Order creation through PHP failed");
  }

  expectedOrderId = Number(createJson.order_id);

  console.log(`Waiting up to 12s for the driver socket to receive 'order:request'...`);
  const orderRequest = await Promise.race([
    orderRequestPromise,
    sleep(12000).then(() => null),
  ]);

  if (!orderRequest) {
    throw new Error(`Driver socket never received order:request — bridge is broken`);
  }
  console.log("Driver socket received order:request successfully:", orderRequest);

  const orderIdToAccept = expectedOrderId || Number(orderRequest.order_id);

  console.log(`Accepting through the PHP URL (${PHP_BASE_URL}/rider_api/accept_order.php) for order ${orderIdToAccept}...`);
  const acceptRes = await fetch(`${PHP_BASE_URL}/rider_api/accept_order.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rider_id: testRiderId, order_id: orderIdToAccept }),
  });
  const acceptJson = await acceptRes.json();
  console.log("PHP accept response:", acceptJson);

  if (acceptJson.Result !== true) {
    throw new Error("Accept through PHP failed: " + (acceptJson.msg || JSON.stringify(acceptJson)));
  }

  console.log("\n=======================================================");
  console.log("🎉 SUCCESS: PHP -> Node bridge round-trip 100% verified!");
  console.log("=======================================================\n");
  driverSocket.disconnect();
  setTimeout(() => process.exit(0), 500);
}

run().catch((err) => {
  console.error("Bridge verification FAILED:", err);
  setTimeout(() => process.exit(1), 500);
});
