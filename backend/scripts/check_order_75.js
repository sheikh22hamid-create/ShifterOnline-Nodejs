async function main() {
  const detRes = await fetch('https://dev-api.shifteronline.com/api/order/details', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: 75, uid: 12 })
  });
  const det = await detRes.json();
  console.log('ORDER 75 DETAILS:', det?.OrderProductList?.[0]?.cancel_reason || det);
}

main().catch(console.error);
