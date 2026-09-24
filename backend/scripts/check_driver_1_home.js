async function main() {
  const homeRes = await fetch('https://dev-api.shifteronline.com/api/rider/home', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rid: 1 })
  });
  const homeData = await homeRes.json();
  console.log("DRIVER 1 HOME DATA:", JSON.stringify(homeData, null, 2));
}

main().catch(console.error);
