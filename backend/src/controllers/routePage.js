// Public, read-only page for a shared completed-ride route. One inline HTML document, no build step
// (same approach as trackPage.js). All dynamic text is set with textContent; the only HTML strings
// below are static literals. It only ever GETs /api/route/<token>.
const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>Shifter Online - Ride route</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" integrity="sha256-tXCrvaljxgtN5LT/Syb5Mm9T+yzPFGH98JVcoJT7JTk=" crossorigin="anonymous">
<style>
  :root { color-scheme: light; --bg:#F7F7F7; --card:#FFFFFF; --text:#202020; --muted:#827E7E; --accent:#FF6B35; --accent2:#FF8A5C; --line:#DEE3E7; }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display:flex; flex-direction:column; }
  header { padding:14px 16px 16px; background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; box-shadow:0 4px 14px rgba(255,107,53,.25); }
  header h1 { font-size:17px; margin:0; font-weight:700; } header .sub { opacity:.92; font-size:13px; margin-top:2px; }
  #stats { display:flex; gap:18px; margin-top:8px; font-size:14px; font-weight:600; } #stats:empty { display:none; }
  #msg { margin:12px; padding:12px 14px; background:var(--card); border:1px solid var(--line); border-radius:12px; font-size:14px; } #msg:empty { display:none; }
  #map { flex:1; min-height:320px; } #mapnote { padding:20px; text-align:center; color:var(--muted); }
  .legend { display:flex; flex-wrap:wrap; gap:6px 14px; padding:10px 14px; background:var(--card); border-top:1px solid var(--line); font-size:12.5px; color:var(--muted); } .legend:empty { display:none; }
  .legend i { display:inline-block; width:18px; height:0; border-top:4px solid; vertical-align:middle; margin-right:5px; border-radius:2px; } .legend i.dash { border-top-style:dashed; }
  .pin { width:16px; height:16px; border-radius:50%; border:3px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,.45); }
  .pin.p { background:#1a73e8; } .pin.d { background:#d93025; } .pin.s { background:#8e44ad; width:20px; height:20px; color:#fff; font:700 11px/14px system-ui,sans-serif; text-align:center; } .pin.f { background:#2e7d32; } .pin.o { background:#fff; border-color:#FF6B35; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<header>
  <h1>Shifter Online</h1>
  <div class="sub" id="sub">Ride route</div>
  <div id="stats"></div>
</header>
<div id="msg"></div>
<div id="map"></div>
<div class="legend" id="legend"></div>
<script type="application/json" id="cfg">__CONFIG__</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" integrity="sha256-XJrs/DDkVkUZ29zdzFOkGCJ9zHVo5hnpdi3c7HYJ7Uc=" crossorigin="anonymous"></script>
<script>
(function () {
  var CONFIG = JSON.parse(document.getElementById("cfg").textContent);
  var token = location.pathname.split("/").filter(Boolean).pop();
  var $ = function (id) { return document.getElementById(id); };
  var COLORS = { 0: "#2563EB", 1: "#F97316" }; // same as the app: driver->pickup blue, pickup->drop orange

  function setMsg(t) { $("msg").textContent = t || ""; }
  function latlng(p) { return [p.lat, p.lng]; }
  function pin(cls, text) { return L.divIcon({ className: "", html: '<div class="pin ' + cls + '">' + (text || "") + "</div>", iconSize: [20, 20], iconAnchor: [10, 10] }); }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function legend(items) {
    var el = $("legend"); el.textContent = "";
    items.forEach(function (it) {
      var span = document.createElement("span"), i = document.createElement("i");
      i.style.borderTopColor = it.color; if (it.dash) i.className = "dash";
      span.appendChild(i); span.appendChild(document.createTextNode(it.label)); el.appendChild(span);
    });
  }

  function initMap() {
    if (!window.L) return null;
    var m = L.map("map", { zoomControl: true }).setView([20.5937, 78.9629], 5);
    var tile = CONFIG.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    var attr = CONFIG.tileUrl ? CONFIG.attribution : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
    L.tileLayer(tile, { maxZoom: 19, attribution: attr }).addTo(m);
    return m;
  }

  // The recorded trail, split wherever the phase changes or the driver went silent (dashed bridge, not a solid line).
  function drawTrail(m, points, bounds) {
    var seg = [], phase = null;
    function flush(dashed) {
      if (seg.length > 1) L.polyline(seg, { color: COLORS[phase] || COLORS[1], weight: 5, opacity: 0.85, dashArray: dashed ? "8 10" : null }).addTo(m);
      seg = [];
    }
    for (var i = 0; i < points.length; i++) {
      var p = points[i], ll = latlng(p);
      bounds.push(ll);
      if (seg.length && (p.phase !== phase || p.gap)) {
        var prev = seg[seg.length - 1];
        flush(false);
        if (p.gap) { L.polyline([prev, ll], { color: COLORS[p.phase] || COLORS[1], weight: 4, opacity: 0.6, dashArray: "6 10" }).addTo(m); }
        else seg = [prev];
      }
      phase = p.phase; seg.push(ll);
    }
    flush(false);
  }

  function render(d) {
    $("sub").textContent = [d.booking_id, fmtDate(d.date)].filter(Boolean).join(" \\u00B7 ");
    // Set any message first: it changes the map's height, and fitBounds must run at the final size.
    if (d.state !== "ready") setMsg("The detailed route was not recorded for this ride, so only the pickup, stops and drop are shown.");
    var m = initMap();
    if (!m) { setMsg("The map could not be loaded. Please check your connection and reload."); return; }
    var bounds = [];
    if (d.state === "ready") {
      drawTrail(m, d.points, bounds);
      var s = document.createElement("span"); s.textContent = "Distance: " + Number(d.distance_km).toFixed(2) + " km";
      $("stats").appendChild(s);
      legend([{ color: COLORS[0], label: "Driver to pickup" }, { color: COLORS[1], label: "Pickup to drop" }, { color: "#827E7E", label: "No signal (gap)", dash: true }]);
    }
    if (d.start) L.marker(latlng(d.start), { icon: pin("f"), interactive: false }).addTo(m);
    if (d.pickup) { L.marker(latlng(d.pickup), { icon: pin("p"), interactive: false }).addTo(m); bounds.push(latlng(d.pickup)); }
    if (d.final_pickup) { L.marker(latlng(d.final_pickup), { icon: pin("p"), interactive: false }).addTo(m); bounds.push(latlng(d.final_pickup)); }
    (d.stops || []).forEach(function (st, i) { L.marker(latlng(st), { icon: pin("s", String(i + 1)), interactive: false }).addTo(m); bounds.push(latlng(st)); });
    if (d.drop) { L.marker(latlng(d.drop), { icon: pin("d"), interactive: false }).addTo(m); bounds.push(latlng(d.drop)); }
    if (bounds.length) m.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 17 });
    var key = [];
    if (d.start) key.push({ color: "#2e7d32", label: "Start" });
    if (d.pickup) key.push({ color: "#1a73e8", label: "Pickup" });
    if ((d.stops || []).length) key.push({ color: "#8e44ad", label: "Stops (numbered)" });
    if (d.drop) key.push({ color: "#d93025", label: "Drop" });
    var el = $("legend");
    key.forEach(function (it) {
      var span = document.createElement("span"), i = document.createElement("i");
      i.style.borderTopColor = it.color; span.appendChild(i); span.appendChild(document.createTextNode(it.label)); el.appendChild(span);
    });
  }

  function unavailable(text) { $("map").hidden = true; $("legend").hidden = true; setMsg(text); }

  fetch("/api/route/" + encodeURIComponent(token), { headers: { Accept: "application/json" } })
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
    .then(function (res) {
      var d = res.body || {};
      if (res.status === 404 || d.state === "invalid") return unavailable("This route link is not valid.");
      if (d.state === "unavailable") return unavailable("This route is not available. The ride may not be completed.");
      if (d.state === "error" || res.status >= 500) return unavailable("Something went wrong. Please try again in a moment.");
      render(d);
    })
    .catch(function () { unavailable("Could not load the route. Please check your connection and try again."); });
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
