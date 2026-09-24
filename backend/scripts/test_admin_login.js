async function main() {
  const users = [
    { username: 'rohit', password: 'rohit@123' },
    { username: 'testadmin', password: 'admin123' },
    { username: 'shifter_city_admin_test', password: 'Password@123' },
    { username: 'kota_admin', password: 'admin123' },
    { username: 'cityadmin', password: 'admin123' },
    { username: 'Ujjain', password: 'Ujjain@1234' },

  ];

  for (const u of users) {
    const res = await fetch('https://dev-api.shifteronline.com/api/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(u)
    });
    const data = await res.json();
    console.log(`[${u.username} / ${u.password}] Status: ${res.status}`, data.success ? "SUCCESS" : data.message);
    if (data.token) {
      console.log("TOKEN:", data.token);
      break;
    }
  }
}

main().catch(console.error);
