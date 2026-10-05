const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Shifter Online - Payment</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#1b1f24; --muted:#5f6b7a; --accent:#0a7d4f; --danger:#b3261e; --line:#e3e6ea; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111418; --card:#1a1f26; --text:#eceff3; --muted:#9aa5b1; --accent:#3ecf8e; --danger:#ff8a80; --line:#2a313a; } }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:420px; margin:0 auto; padding:24px 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; }
  h1 { font-size:20px; margin:0 0 4px; } .muted { color:var(--muted); font-size:14px; }
  dl { margin:16px 0; } dl div { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line); }
  dt { color:var(--muted); } dd { margin:0; font-weight:600; text-align:right; }
  .total dd, .total dt { font-size:18px; color:var(--text); }
  button { width:100%; padding:14px; border-radius:10px; border:0; font-size:16px; font-weight:600; cursor:pointer; margin-top:10px; }
  #pay { background:var(--accent); color:#fff; } #decline { background:transparent; color:var(--danger); border:1px solid var(--line); }
  button:disabled { opacity:.6; cursor:default; } #msg { margin-top:12px; min-height:1.4em; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Shifter Online</h1>
    <p class="muted" id="sub">Loading...</p>
    <dl id="breakup" hidden></dl>
    <button id="pay" hidden>Pay now</button>
    <button id="decline" hidden>Decline</button>
    <p id="msg" role="status"></p>
  </div>
</main>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
(function () {
  var token = location.pathname.split("/").filter(Boolean).pop();
  var api = "/api/pay/" + encodeURIComponent(token);
  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return "\\u20B9" + Number(n).toFixed(2); };
  function say(t) { $("msg").textContent = t || ""; }
  function row(label, value, cls) {
    var d = document.createElement("div"); if (cls) d.className = cls;
    var dt = document.createElement("dt"); dt.textContent = label;
    var dd = document.createElement("dd"); dd.textContent = value;
    d.appendChild(dt); d.appendChild(dd); return d;
  }
  function show(s) {
    $("pay").hidden = $("decline").hidden = $("breakup").hidden = true;
    if (s.state === "payable") {
      $("sub").textContent = "Order #" + s.order_id + (s.booker_first_name ? " - booked by " + s.booker_first_name : "");
      var b = $("breakup"); b.textContent = "";
      if (s.driver_first_name) b.appendChild(row("Driver", s.driver_first_name));
      if (s.pickup) b.appendChild(row("Pickup", s.pickup));
      if (s.drop) b.appendChild(row("Drop", s.drop));
      b.appendChild(row("Fare", money(s.amount_due)));
      if (s.markup > 0) b.appendChild(row("Service fee", money(s.markup)));
      b.appendChild(row("Total", money(s.total), "total"));
      b.hidden = false; $("pay").hidden = false; $("decline").hidden = false;
      $("pay").disabled = $("decline").disabled = false; say("");
    } else if (s.state === "paid") { $("sub").textContent = "Payment received. Thank you!"; say("");
    } else if (s.state === "expired") { $("sub").textContent = "This payment link has expired."; say("Please ask the sender or driver to resend it.");
    } else { $("sub").textContent = "No payment is needed for this order."; say(""); }
  }
  function post(path) { return fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (r) { return r.json(); }); }
  function load() { return fetch(api).then(function (r) { return r.json(); }).then(function (s) { if (!s.success) { $("sub").textContent = "This payment link is not valid."; return; } show(s); }).catch(function () { say("Could not load. Check your connection."); }); }

  $("pay").addEventListener("click", function () {
    $("pay").disabled = $("decline").disabled = true; say("Starting payment...");
    post("/order").then(function (o) {
      if (!o.success) { say(o.message || "Could not start payment."); $("pay").disabled = $("decline").disabled = false; return; }
      var rz = new Razorpay({
        key: o.key_id, order_id: o.razorpay_order_id, amount: o.amount_paise, currency: o.currency, name: "Shifter Online",
        handler: function (resp) {
          say("Confirming payment...");
          fetch(api + "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            razorpay_payment_id: resp.razorpay_payment_id, razorpay_order_id: resp.razorpay_order_id, razorpay_signature: resp.razorpay_signature }) })
            .then(function (r) { return r.json(); })
            .then(function (v) { if (v.success) { show({ state: "paid" }); } else { say(v.message || "Could not confirm payment. If money was deducted it will be reconciled."); } });
        },
        modal: { ondismiss: function () { $("pay").disabled = $("decline").disabled = false; say(""); } }
      });
      rz.open();
    }).catch(function () { say("Could not start payment."); $("pay").disabled = $("decline").disabled = false; });
  });
  $("decline").addEventListener("click", function () {
    if (!confirm("Decline paying for this order? The sender will be asked to pay instead.")) return;
    $("pay").disabled = $("decline").disabled = true;
    post("/decline").then(function (d) { if (d.success) { show({ state: "closed" }); say("You declined. The sender will be notified."); } else { say(d.message || "Could not decline."); $("pay").disabled = $("decline").disabled = false; } });
  });
  load();
})();
</script>
</body>
</html>`;

module.exports = { PAGE_HTML };
