// backend/src/controllers/trackPage.js
// Public receiver tracking page. One inline HTML document, no build step (same approach as
// receiverPayPage.js). All dynamic text is set with textContent; the only HTML strings below are
// static literals. The map is a progressive enhancement: without Leaflet or tiles the timeline, ETA
// and driver card still work.
const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Shifter Online - Track delivery</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#1b1f24; --muted:#5f6b7a; --accent:#0a7d4f; --warn:#b26a00; --line:#e3e6ea; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111418; --card:#1a1f26; --text:#eceff3; --muted:#9aa5b1; --accent:#3ecf8e; --warn:#ffb74d; --line:#2a313a; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.45 system-ui, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:12px 12px 24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin-bottom:10px; }
  h1 { font-size:18px; margin:0; } .muted { color:var(--muted); font-size:14px; }
  #status { font-size:20px; font-weight:700; margin:2px 0; }
  #eta { font-size:15px; color:var(--accent); font-weight:600; min-height:1.2em; }
  #offline, #stale { color:var(--warn); font-size:13px; min-height:1.1em; }
  #map { height:48vh; min-height:260px; border-radius:12px; border:1px solid var(--line); margin-bottom:10px; }
  ol { list-style:none; margin:8px 0 0; padding:0; }
  li { position:relative; padding:6px 0 6px 28px; color:var(--muted); }
  li::before { content:""; position:absolute; left:6px; top:11px; width:12px; height:12px; border-radius:50%; border:2px solid var(--line); background:var(--card); }
  li.done { color:var(--text); } li.done::before { background:var(--accent); border-color:var(--accent); }
  li.current { color:var(--text); font-weight:700; } li.current::before { border-color:var(--accent); box-shadow:0 0 0 4px rgba(10,125,79,.2); }
  .driver { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .driver b { display:block; } a.call { background:var(--accent); color:#fff; text-decoration:none; padding:10px 16px; border-radius:10px; font-weight:600; white-space:nowrap; }
  .pin { width:14px; height:14px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.4); }
  .pin.p { background:#1a73e8; } .pin.d { background:#d93025; }
  .car { width:34px; height:34px; } .car > div { width:34px; height:34px; transition:transform .3s linear; }
  .car svg { width:34px; height:34px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); } .car.stale svg { opacity:.45; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Shifter Online</h1>
    <div class="muted" id="order"></div>
    <div id="status">Loading...</div>
    <div id="eta"></div>
    <div id="stale"></div>
    <div id="offline"></div>
  </div>
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
  <div class="card"><ol id="steps"></ol></div>
</main>
<script type="application/json" id="cfg">__CONFIG__</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script>
(function () {
  var CONFIG = JSON.parse(document.getElementById("cfg").textContent);
  var token = location.pathname.split("/").filter(Boolean).pop();
  var api = "/api/track/" + encodeURIComponent(token);
  var $ = function (id) { return document.getElementById(id); };
  var STEPS = [["assigned", "Driver assigned"], ["reached_pickup", "Reached pickup"], ["on_the_way", "On the way"], ["reached_drop", "Reached drop"], ["delivered", "Delivered"]];
  var HEADLINES = { 0: "Looking for a driver", 1: "Driver is heading to the pickup point", 2: "Driver reached the pickup point", 3: "Your parcel is on the way", 4: "Driver has reached your location", 5: "Delivered" };
  var CAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="#0a7d4f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var map = null, driverMarker = null, pickupMarker = null, dropMarker = null, routeLine = null, fitted = false;
  var timer = null, pollMs = 5000, failures = 0, anim = null, lastKey = "";

  function setText(id, text) { $(id).textContent = text || ""; }
  function terminal(state) { return state === "delivered" || state === "cancelled" || state === "expired" || state === "invalid"; }

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

  function drawMap(s) {
    if (!(s.pickup || s.drop || s.position)) return;
    if (!ensureMap()) return;
    var pts = [];
    if (s.route && s.route.length > 1) {
      var key = s.route.length + ":" + s.route[0] + ":" + s.route[s.route.length - 1];
      if (key !== lastKey) { if (routeLine) map.removeLayer(routeLine); routeLine = L.polyline(s.route, { color: "#1a73e8", weight: 5, opacity: 0.8 }).addTo(map); lastKey = key; }
      pts = pts.concat(s.route);
    }
    if (s.pickup) {
      if (!pickupMarker) pickupMarker = L.marker([s.pickup.lat, s.pickup.lng], { icon: pinIcon("p"), interactive: false }).addTo(map);
      else pickupMarker.setLatLng([s.pickup.lat, s.pickup.lng]);
    }
    if (s.drop) {
      if (!dropMarker) dropMarker = L.marker([s.drop.lat, s.drop.lng], { icon: pinIcon("d"), interactive: false }).addTo(map);
      else dropMarker.setLatLng([s.drop.lat, s.drop.lng]);
    }
    if (s.pickup) pts.push([s.pickup.lat, s.pickup.lng]);
    if (s.drop) pts.push([s.drop.lat, s.drop.lng]);
    if (s.position) { moveDriver(s.position); pts.push([s.position.lat, s.position.lng]); }
    if (!fitted && pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 }); fitted = true; }
  }

  function render(s) {
    setText("order", s.order_id ? "Order #" + s.order_id : "");
    $("driverCard").hidden = true; $("addrCard").hidden = true;
    setText("eta", ""); setText("stale", "");
    if (s.state === "invalid" || s.state === "expired" || s.state === "cancelled") {
      var msg = s.state === "cancelled" ? "This order was cancelled" : s.state === "expired" ? "This tracking link has expired" : "This tracking link is no longer valid";
      setText("status", msg); $("steps").textContent = ""; if (map) $("map").hidden = true; return;
    }
    if (s.state === "delivered") {
      setText("status", "Delivered"); setText("eta", fmtDelivered(s.delivered_at)); renderSteps(5); if (map) $("map").hidden = true; return;
    }
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
        failures = 0; setText("offline", "");
        var s = x.body || {};
        if (s.state === "error") { throw new Error("server"); }
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
