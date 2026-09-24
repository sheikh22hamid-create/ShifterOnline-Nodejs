async function main() {
  const detRes = await fetch('https://dev-api.shifteronline.com/api/order/details', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: 74, uid: 12 })
  });
  const det = await detRes.json();
  console.log('ORDER 74 DETAILS:', JSON.stringify(det, null, 2));
}

main().catch(console.error);
