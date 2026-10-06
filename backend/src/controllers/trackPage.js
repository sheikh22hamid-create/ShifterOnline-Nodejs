// backend/src/controllers/trackPage.js
// Public receiver tracking page. One inline HTML document, no build step (same approach as
// receiverPayPage.js). All dynamic text is set with textContent; the only HTML strings below are
// static literals. The map is a progressive enhancement: without Leaflet or tiles everything except
// the map still works. Light app theme only (orange #FF6B35).
const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>Shifter Online - Track delivery</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" integrity="sha256-tXCrvaljxgtN5LT/Syb5Mm9T+yzPFGH98JVcoJT7JTk=" crossorigin="anonymous">
<style>
  :root { color-scheme: light; --bg:#F7F7F7; --card:#FFFFFF; --text:#202020; --muted:#827E7E; --accent:#FF6B35; --accent2:#FF8A5C; --ok:#0B8A12; --warn:#E68C00; --err:#D93025; --line:#DEE3E7; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:0 12px 28px; }
  header { margin:0 -12px 12px; padding:16px 16px 18px; background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; border-radius:0 0 18px 18px; box-shadow:0 4px 14px rgba(255,107,53,.25); }
  header h1 { font-size:17px; margin:0; font-weight:700; letter-spacing:.2px; } header .sub { opacity:.9; font-size:13px; margin-top:2px; }
  #status { font-size:22px; font-weight:800; margin:10px 0 2px; line-height:1.2; }
  #eta { font-size:15px; font-weight:600; min-height:1.2em; }
  #offline, #stale { font-size:13px; min-height:1.1em; background:rgba(0,0,0,.12); border-radius:8px; padding:0 6px; } #offline:empty, #stale:empty { display:none; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; margin-bottom:10px; box-shadow:0 1px 3px rgba(0,0,0,.04); }
  h2 { font-size:15px; margin:0 0 8px; } .muted { color:var(--muted); font-size:13px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:5px 0; border-bottom:1px solid var(--line); font-size:14px; } .row:last-of-type { border-bottom:0; }
  .row > :last-child { text-align:right; font-weight:600; } .row.total { font-size:17px; font-weight:800; }
  #map { height:46vh; min-height:260px; border-radius:14px; border:1px solid var(--line); margin-bottom:10px; overflow:hidden; }
  ol { list-style:none; margin:4px 0 0; padding:0; }
  li { position:relative; padding:6px 0 6px 28px; color:var(--muted); }
  li::before { content:""; position:absolute; left:6px; top:11px; width:12px; height:12px; border-radius:50%; border:2px solid var(--line); background:var(--card); }
  li.done { color:var(--text); } li.done::before { background:var(--accent); border-color:var(--accent); }
  li.current { color:var(--text); font-weight:700; } li.current::before { border-color:var(--accent); box-shadow:0 0 0 4px rgba(255,107,53,.2); }
  .driver { display:flex; align-items:center; justify-content:space-between; gap:12px; } .driver b { display:block; }
  .btn { display:block; width:100%; text-align:center; background:var(--accent); color:#fff; text-decoration:none; border:0; border-radius:12px; padding:13px 16px; font:inherit; font-weight:700; cursor:pointer; margin-top:10px; }
  .btn.ghost { background:#fff; color:var(--accent); border:1.5px solid var(--accent); } .btn:disabled { opacity:.6; cursor:default; }
  a.call { background:var(--accent); color:#fff; text-decoration:none; padding:10px 16px; border-radius:10px; font-weight:700; white-space:nowrap; }
  .ok { color:var(--ok); font-weight:700; margin-top:8px; } .err { color:var(--err); font-size:13px; min-height:1.1em; margin-top:6px; }
  .stars { display:flex; gap:6px; margin:4px 0 10px; } .star { background:none; border:0; font-size:30px; line-height:1; color:var(--line); cursor:pointer; padding:0 2px; } .star.on { color:#F5A623; }
  .tags { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; } .tag { background:#fff; border:1.5px solid var(--line); color:var(--text); border-radius:999px; padding:6px 12px; font:inherit; font-size:13px; cursor:pointer; } .tag.on { border-color:var(--accent); background:rgba(255,107,53,.1); color:var(--accent); font-weight:700; }
  textarea { width:100%; min-height:70px; border:1.5px solid var(--line); border-radius:10px; padding:10px; font:inherit; font-size:14px; resize:vertical; }
  .pin { width:14px; height:14px; border-radius:50%; border:3px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,.45); } .pin.p { background:#1a73e8; } .pin.d { background:#d93025; }
  .car { width:34px; height:34px; } .car > div { width:34px; height:34px; transition:transform .3s linear; }
  .car svg { width:34px; height:34px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); } .car.stale svg { opacity:.45; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Shifter Online</h1>
    <div class="sub" id="order"></div>
    <div id="status">Loading...</div>
    <div id="eta"></div>
    <div id="stale"></div>
    <div id="offline"></div>
  </header>
  <div id="map" hidden></div>
  <div class="card" id="driverCard" hidden>
    <div class="driver">
      <div><b id="driverName"></b><span class="muted" id="driverVehicle"></span></div>
      <a class="call" id="call" href="#">Call driver</a>
    </div>
  </div>
  <div class="card" id="addrCard" hidden>
    <div class="muted">Pickup</div><div id="pickupAddr"></div>
    <div class="muted" style="margin-top:8px">Drop</div><div id="dropAddr"></div>
  </div>
  <div class="card" id="summaryCard" hidden>
    <h2>Trip summary</h2>
    <div class="row"><span class="muted">Driver</span><span id="sumDriver"></span></div>
    <div class="row"><span class="muted">Pickup</span><span id="sumPickup"></span></div>
    <div class="row"><span class="muted">Drop</span><span id="sumDrop"></span></div>
    <div class="row"><span class="muted">Distance</span><span id="sumDistance"></span></div>
  </div>
  <div class="card" id="payCard" hidden>
    <h2>Payment</h2>
    <div class="row"><span class="muted">Fare</span><span id="payFare"></span></div>
    <div class="row" id="payFeeRow"><span class="muted">Service fee</span><span id="payFee"></span></div>
    <div class="row total"><span>Total</span><span id="payTotal"></span></div>
    <button class="btn" id="payBtn" type="button">Pay now</button>
    <div class="ok" id="paidNote" hidden>Paid &#10003;</div>
    <div class="err" id="payMsg" role="status"></div>
  </div>
  <div class="card" id="reviewCard" hidden>
    <h2>Rate your delivery</h2>
    <div class="muted">Driver</div><div class="stars" id="starsDriver"></div>
    <div class="muted">Delivery</div><div class="stars" id="starsDelivery"></div>
    <div class="tags" id="tags"></div>
    <textarea id="comment" maxlength="500" placeholder="Anything else? (optional)"></textarea>
    <button class="btn" id="reviewBtn" type="button">Submit</button>
    <div class="err" id="reviewMsg" role="status"></div>
  </div>
  <div class="card" id="thanksCard" hidden><div class="ok">Thanks for your feedback &#10003;</div></div>
  <div class="card" id="helpCard" hidden>
    <h2>Need help?</h2>
    <a class="btn ghost" id="helpCall" href="#">Call support</a>
    <a class="btn ghost" id="helpWa" href="#" target="_blank" rel="noopener">WhatsApp</a>
  </div>
  <a class="btn" id="appBtn" href="#" hidden>Get the Shifter Online app</a>
  <div class="card"><ol id="steps"></ol></div>
</main>
<script type="application/json" id="cfg">__CONFIG__</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" integrity="sha256-XJrs/DDkVkUZ29zdzFOkGCJ9zHVo5hnpdi3c7HYJ7Uc=" crossorigin="anonymous"></script>
<script>
(function () {
  var CONFIG = JSON.parse(document.getElementById("cfg").textContent);
  var token = location.pathname.split("/").filter(Boolean).pop();
  var api = "/api/track/" + encodeURIComponent(token);
  var $ = function (id) { return document.getElementById(id); };
  var STEPS = [["assigned", "Driver assigned"], ["reached_pickup", "Reached pickup"], ["on_the_way", "On the way"], ["reached_drop", "Reached drop"], ["delivered", "Delivered"]];
  var HEADLINES = { 0: "Looking for a driver", 1: "Driver is heading to the pickup point", 2: "Driver reached the pickup point", 3: "Your parcel is on the way", 4: "Driver has reached your location", 5: "Delivered" };
  var POSITIVE = ["Polite & Helpful", "On-Time Arrival", "Careful with items", "Safe Driving", "Clean Vehicle"];
  var NEGATIVE = ["Delayed Arrival", "Demanded Extra Cash", "Careless Handling", "Rash Driving", "Rude Behaviour"];
  var CAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="#FF6B35" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var DELIVERED_CARDS = ["summaryCard", "payCard", "reviewCard", "thanksCard", "helpCard", "appBtn"];
  var map = null, driverMarker = null, pickupMarker = null, dropMarker = null, routeLine = null, fitted = false;
  var timer = null, pollMs = 5000, failures = 0, anim = null, lastKey = "";
  var rating = { driver: 0, delivery: 0 }, chosen = {}, stars = { driver: [], delivery: [] }, reviewBuilt = false, paying = false, sending = false;

  function setText(id, text) { $(id).textContent = text || ""; }
  function terminal(state) { return state === "delivered" || state === "cancelled" || state === "expired" || state === "invalid"; }
  function money(n) { return "\\u20B9" + Number(n).toFixed(2); }
  function digits(v) { return String(v || "").replace(/[^0-9]/g, ""); }

  function renderSteps(step) {
    var ol = $("steps"); ol.textContent = "";
    for (var i = 0; i < STEPS.length; i++) {
      var li = document.createElement("li");
      var n = i + 1;
      li.textContent = STEPS[i][1];
      if (n < step || (n === step && step === 5)) li.className = "done";
      else if (n === step) li.className = "current";
      ol.appendChild(li);
    }
  }

  function fmtDelivered(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return "Delivered on " + d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function ensureMap() {
    if (map) return true;
    if (!window.L || !CONFIG.tileUrl) return false;
    try {
      $("map").hidden = false;
      map = L.map("map", { zoomControl: true, attributionControl: true }).setView([20.5937, 78.9629], 5);
      L.tileLayer(CONFIG.tileUrl, { maxZoom: 19, attribution: CONFIG.attribution }).addTo(map);
      return true;
    } catch (e) { map = null; $("map").hidden = true; return false; }
  }

  function pinIcon(cls) { return L.divIcon({ className: "", html: '<div class="pin ' + cls + '"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }); }
  function carIcon() { return L.divIcon({ className: "car", html: "<div>" + CAR_SVG + "</div>", iconSize: [34, 34], iconAnchor: [17, 17] }); }

  function moveDriver(pos) {
    var to = L.latLng(pos.lat, pos.lng);
    if (!driverMarker) { driverMarker = L.marker(to, { icon: carIcon(), interactive: false }).addTo(map); }
    var el = driverMarker.getElement();
    if (el) {
      if (pos.stale) el.classList.add("stale"); else el.classList.remove("stale");
      var inner = el.firstChild;
      if (inner && inner.style) inner.style.transform = "rotate(" + (Number(pos.heading) || 0) + "deg)";
    }
    var from = driverMarker.getLatLng();
    if (anim) cancelAnimationFrame(anim);
    var start = null, dur = Math.min(pollMs, 4000);
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      driverMarker.setLatLng([from.lat + (to.lat - from.lat) * t, from.lng + (to.lng - from.lng) * t]);
      if (t < 1) anim = requestAnimationFrame(frame);
    }
    anim = requestAnimationFrame(frame);
  }

  // Pickup and drop pins; existing pins follow a changed coordinate.
  function placePins(pickup, drop) {
    if (pickup) {
      if (!pickupMarker) pickupMarker = L.marker([pickup.lat, pickup.lng], { icon: pinIcon("p"), interactive: false }).addTo(map);
      else pickupMarker.setLatLng([pickup.lat, pickup.lng]);
    }
    if (drop) {
      if (!dropMarker) dropMarker = L.marker([drop.lat, drop.lng], { icon: pinIcon("d"), interactive: false }).addTo(map);
      else dropMarker.setLatLng([drop.lat, drop.lng]);
    }
  }

  function drawMap(s) {
    if (!(s.pickup || s.drop || s.position)) return;
    if (!ensureMap()) return;
    var pts = [];
    if (s.route && s.route.length > 1) {
      var key = s.route.length + ":" + s.route[0] + ":" + s.route[s.route.length - 1];
      if (key !== lastKey) { if (routeLine) map.removeLayer(routeLine); routeLine = L.polyline(s.route, { color: "#1a73e8", weight: 5, opacity: 0.8 }).addTo(map); lastKey = key; }
      pts = pts.concat(s.route);
    }
    placePins(s.pickup, s.drop);
    if (s.pickup) pts.push([s.pickup.lat, s.pickup.lng]);
    if (s.drop) pts.push([s.drop.lat, s.drop.lng]);
    if (s.position) { moveDriver(s.position); pts.push([s.position.lat, s.position.lng]); }
    if (!fitted && pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 }); fitted = true; }
  }

  // After delivery: the route the driver actually drove plus the two pins; the live marker and route go away.
  function drawTripRoute(tr) {
    if (!tr || !(tr.pickup || tr.drop || (tr.points && tr.points.length))) { if (map) $("map").hidden = true; return; }
    if (!ensureMap()) return;
    $("map").hidden = false;
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    lastKey = "";
    var pts = [];
    if (tr.points && tr.points.length > 1) {
      routeLine = L.polyline(tr.points, { color: "#1a73e8", weight: 5, opacity: 0.8 }).addTo(map);
      pts = pts.concat(tr.points);
    }
    placePins(tr.pickup, tr.drop);
    if (tr.pickup) pts.push([tr.pickup.lat, tr.pickup.lng]);
    if (tr.drop) pts.push([tr.drop.lat, tr.drop.lng]);
    if (pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 }); fitted = true; }
  }

  function post(path, body) {
    return fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  // ---- review form ----
  function paintStars(group) {
    for (var i = 0; i < 5; i++) stars[group][i].className = "star" + (i < rating[group] ? " on" : "");
  }
  function buildStars(group, boxId) {
    var box = $(boxId); box.textContent = ""; stars[group] = [];
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "star"; b.textContent = "\\u2605";
        b.setAttribute("aria-label", n + (n === 1 ? " star" : " stars"));
        b.addEventListener("click", function () { rating[group] = n; paintStars(group); if (group === "driver") buildTags(); });
        box.appendChild(b); stars[group].push(b);
      })(i);
    }
  }
  function buildTags() {
    var list = rating.driver > 0 && rating.driver <= 3 ? NEGATIVE : POSITIVE;
    var box = $("tags"); box.textContent = "";
    var keep = {};
    for (var i = 0; i < list.length; i++) {
      (function (label) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = label; b.className = "tag" + (chosen[label] ? " on" : "");
        if (chosen[label]) keep[label] = true;
        b.addEventListener("click", function () { chosen[label] = !chosen[label]; b.className = "tag" + (chosen[label] ? " on" : ""); });
        box.appendChild(b);
      })(list[i]);
    }
    chosen = keep;
  }
  function ensureReviewForm() {
    if (reviewBuilt) return;
    buildStars("driver", "starsDriver"); buildStars("delivery", "starsDelivery"); buildTags(); reviewBuilt = true;
  }
  function thanks() { $("reviewCard").hidden = true; $("thanksCard").hidden = false; }

  $("reviewBtn").addEventListener("click", function () {
    if (sending) return;
    if (!rating.driver && !rating.delivery) { setText("reviewMsg", "Please give a rating first."); return; }
    sending = true; $("reviewBtn").disabled = true; setText("reviewMsg", "");
    var tags = []; for (var k in chosen) { if (chosen[k]) tags.push(k); }
    var fail = function (msg) { sending = false; $("reviewBtn").disabled = false; setText("reviewMsg", msg || "Could not send your feedback. Please try again."); };
    post("/review", { driver_rating: rating.driver || undefined, delivery_rating: rating.delivery || undefined, tags: tags, comment: $("comment").value })
      .then(function (x) {
        if ((x.body && x.body.ok) || x.status === 409) { sending = false; $("reviewBtn").disabled = false; thanks(); return; }
        fail(x.body && x.body.message);
      })
      .catch(function () { fail(); });
  });

  // ---- pay ----
  $("payBtn").addEventListener("click", function () {
    if (paying) return;
    paying = true; $("payBtn").disabled = true; setText("payMsg", "");
    var fail = function (msg) { paying = false; $("payBtn").disabled = false; setText("payMsg", msg || "Could not start the payment. Please try again."); };
    post("/pay-link", {})
      .then(function (x) {
        if (x.body && x.body.ok && /^https?:\\/\\//.test(String(x.body.url || ""))) { location.href = x.body.url; return; }
        fail(x.body && x.body.ok ? "" : (x.body && x.body.message));
      })
      .catch(function () { fail(); });
  });

  function renderDelivered(s) {
    setText("status", "Delivered"); setText("eta", fmtDelivered(s.delivered_at)); renderSteps(5);
    var sm = s.summary;
    if (sm) {
      $("summaryCard").hidden = false;
      var d = sm.driver;
      setText("sumDriver", d && d.first_name ? d.first_name + (d.vehicle_no ? " \\u00B7 " + d.vehicle_no : "") : "\\u2014");
      setText("sumPickup", sm.pickup && sm.pickup.address ? sm.pickup.address : "\\u2014");
      setText("sumDrop", sm.drop && sm.drop.address ? sm.drop.address : "\\u2014");
      setText("sumDistance", sm.distance_km != null ? sm.distance_km + " km" : "\\u2014");
    }
    drawTripRoute(s.trip_route);
    var p = s.pay;
    if (p) {
      $("payCard").hidden = false;
      setText("payFare", money(p.amount_due)); setText("payTotal", money(p.total));
      $("payFeeRow").hidden = !(Number(p.markup) > 0); setText("payFee", money(p.markup));
      $("payBtn").hidden = p.state === "paid"; $("paidNote").hidden = p.state !== "paid";
    }
    if (s.review && s.review.submitted) { $("thanksCard").hidden = false; }
    else { $("reviewCard").hidden = false; ensureReviewForm(); }
    if (s.help) {
      $("helpCard").hidden = false;
      $("helpCall").href = "tel:" + digits(s.help.phone);
      $("helpWa").href = "https://wa.me/" + digits(s.help.whatsapp) + "?text=" + encodeURIComponent("Order #" + s.order_id + " - I need help");
    }
    if (/^https:\\/\\//.test(String(s.app_url || ""))) { $("appBtn").href = s.app_url; $("appBtn").hidden = false; }
  }

  function render(s) {
    setText("order", s.order_id ? "Order #" + s.order_id : "");
    $("driverCard").hidden = true; $("addrCard").hidden = true;
    for (var c = 0; c < DELIVERED_CARDS.length; c++) $(DELIVERED_CARDS[c]).hidden = true;
    setText("eta", ""); setText("stale", "");
    if (s.state === "invalid" || s.state === "expired" || s.state === "cancelled") {
      var msg = s.state === "cancelled" ? "This order was cancelled" : s.state === "expired" ? "This tracking link has expired" : "This tracking link is no longer valid";
      setText("status", msg); $("steps").textContent = ""; if (map) $("map").hidden = true; return;
    }
    if (s.state === "delivered") { renderDelivered(s); return; }
    if (s.state !== "active") { return; }
    var step = s.step || 0;
    setText("status", HEADLINES[step] || "Tracking");
    renderSteps(step);
    if (s.eta) setText("eta", "Arriving in ~" + s.eta.minutes + " min" + (s.eta.distance_km != null ? " \\u00B7 " + s.eta.distance_km + " km away" : ""));
    if (s.position && s.position.stale) setText("stale", "Waiting for the driver's location");
    if (s.driver && s.driver.first_name) {
      $("driverCard").hidden = false;
      setText("driverName", s.driver.first_name);
      setText("driverVehicle", s.driver.vehicle_no ? " \\u00B7 " + s.driver.vehicle_no : "");
      var phone = String(s.driver.phone || "").replace(/[^0-9+]/g, "");
      if (phone) { $("call").href = "tel:" + phone; $("call").hidden = false; } else { $("call").hidden = true; }
    }
    if (s.pickup || s.drop) {
      $("addrCard").hidden = false;
      setText("pickupAddr", s.pickup ? s.pickup.address : ""); setText("dropAddr", s.drop ? s.drop.address : "");
    }
    drawMap(s);
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(load, pollMs); }

  function load() {
    if (document.hidden) { schedule(); return; }
    fetch(api, { cache: "no-store" })
      .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
      .then(function (x) {
        var s = x.body || {};
        // A 429 / proxy error body has no state: keep the last render and back off.
        if (typeof s.state !== "string" || s.state === "error") { throw new Error("server"); }
        failures = 0; setText("offline", "");
        render(s);
        pollMs = s.poll_ms || 5000;
        if (!terminal(s.state)) schedule();
      })
      .catch(function () {
        failures += 1; setText("offline", "Connection problem - retrying...");
        pollMs = Math.min(30000, 5000 * Math.pow(2, Math.min(failures, 3)));
        schedule();
      });
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) { clearTimeout(timer); load(); } });
  load();
})();
</script>
</body>
</html>`;

function renderPage(config) {
  const safe = JSON.stringify({
    tileUrl: (config && config.tileUrl) || null,
    attribution: (config && config.attribution) || "",
  }).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__CONFIG__", () => safe);
}

module.exports = { renderPage };
