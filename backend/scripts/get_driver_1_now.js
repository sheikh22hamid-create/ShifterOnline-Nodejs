async function main() {
  const res = await fetch('https://dev-api.shifteronline.com/api/rider/test-drivers');
  const data = await res.json();
  const d1 = data.drivers.find(d => d.id === 1);
  console.log('DRIVER 1 CURRENT STATE:', d1);
}

main().catch(console.error);
