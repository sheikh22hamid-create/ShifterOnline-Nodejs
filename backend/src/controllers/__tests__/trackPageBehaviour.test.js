// Behaviour tests for the tracking page script, run against a minimal hand-written fake DOM
// (jsdom is not installed and must not be added as a dependency).
const { renderPage } = require("../trackPage");

function makeEl() {
  const el = {
    textContent: "", hidden: false, href: "", className: "", children: [], style: {},
    classList: { add() {}, remove() {} },
    appendChild(c) { el.children.push(c); return c; },
  };
  Object.defineProperty(el, "textContent", {
    get() { return el._t || ""; },
    set(v) { el._t = String(v); if (v === "") el.children = []; },
  });
  return el;
}

function boot(snapshots, opts = {}) {
  const html = renderPage({ tileUrl: opts.tileUrl || null, attribution: "" });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const els = {};
  const document = {
    hidden: !!opts.hidden,
    getElementById(id) { return (els[id] = els[id] || makeEl()); },
    createElement() { return makeEl(); },
    addEventListener() {},
  };
  document.getElementById("cfg").textContent = JSON.stringify({ tileUrl: opts.tileUrl || null, attribution: "" });
  document.getElementById("map").hidden = true;
  const timers = [];
  const fetchCalls = [];
  let i = 0;
  const fetchStub = (url) => {
    fetchCalls.push(url);
    const body = snapshots[Math.min(i++, snapshots.length - 1)];
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve({ status: body && body.__status ? body.__status : 200, json: () => Promise.resolve(body) });
  };
  const win = opts.L ? { L: opts.L } : {};
  new Function("document", "location", "fetch", "setTimeout", "clearTimeout", "window", "L", script)(
    document, { pathname: "/track/abc123" }, fetchStub,
    (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, win, opts.L
  );
  const flush = () => new Promise((r) => setImmediate(r));
  return { els, timers, fetchCalls, flush, document };
}

describe("tracking page script", () => {
  it("polls the token URL, sanitises the tel: link and renders text only", async () => {
    const p = boot([{
      state: "active", order_id: 7, step: 3, poll_ms: 5000,
      eta: { minutes: 12, distance_km: 3.4 }, position: null,
      driver: { first_name: "<b>Ravi</b>", phone: "+91 (98765)-43210; evil", vehicle_no: "DL1" },
    }]);
    await p.flush();
    expect(p.fetchCalls[0]).toBe("/api/track/abc123");
    expect(p.els.call.href).toBe("tel:+919876543210");
    expect(p.els.driverName.textContent).toBe("<b>Ravi</b>");
    expect(p.els.status.textContent).toBe("Your parcel is on the way");
    expect(p.els.steps.children.length).toBe(5);
    expect(p.els.steps.children[0].className).toBe("done");
    expect(p.els.steps.children[2].className).toBe("current");
    expect(p.els.eta.textContent).toContain("12 min");
    expect(p.timers.length).toBe(1);
  });

  it("renders an active snapshot with null eta, null position and step 0 without throwing", async () => {
    const p = boot([{ state: "active", order_id: 1, step: 0, eta: null, position: null, driver: null }]);
    await p.flush();
    expect(p.els.status.textContent).toBe("Looking for a driver");
    expect(p.els.eta.textContent).toBe("");
    expect(p.els.offline.textContent).toBe("");
    expect(p.els.driverCard.hidden).toBe(true);
  });

  it("hides the call button when the phone has no digits", async () => {
    const p = boot([{ state: "active", step: 1, driver: { first_name: "A", phone: "n/a" } }]);
    await p.flush();
    expect(p.els.call.hidden).toBe(true);
  });

  it.each(["delivered", "cancelled", "expired", "invalid"])("stops polling on terminal state %s", async (state) => {
    const p = boot([{ state, order_id: 1 }]);
    await p.flush();
    expect(p.fetchCalls.length).toBe(1);
    expect(p.timers.length).toBe(0);
  });

  it("keeps polling after a network failure and shows a retry notice", async () => {
    const p = boot([new Error("down")]);
    await p.flush();
    expect(p.els.offline.textContent).toMatch(/retrying/);
    expect(p.timers.length).toBe(1);
  });

  it("a 429 body without state keeps the previous render, shows the retry note and backs off", async () => {
    const p = boot([
      { state: "active", step: 3, poll_ms: 5000, driver: { first_name: "Ravi", phone: "123" } },
      { __status: 429, success: false, message: "Too many requests" },
    ]);
    await p.flush();
    expect(p.els.status.textContent).toBe("Your parcel is on the way");
    p.timers[0].fn();
    await p.flush();
    expect(p.els.status.textContent).toBe("Your parcel is on the way");
    expect(p.els.driverName.textContent).toBe("Ravi");
    expect(p.els.offline.textContent).toMatch(/retrying/);
    expect(p.timers.length).toBe(2);
    expect(p.timers[1].ms).toBeGreaterThan(5000);
  });
  it("an invalid 404 with state still renders and stops polling", async () => {
    const p = boot([{ __status: 404, state: "invalid", poll_ms: 15000 }]);
    await p.flush();
    expect(p.els.status.textContent).toMatch(/no longer valid/);
    expect(p.els.offline.textContent).toBe("");
    expect(p.timers.length).toBe(0);
  });

  it("does not fetch while the tab is hidden, only reschedules", async () => {
    const p = boot([{ state: "active", step: 1 }], { hidden: true });
    await p.flush();
    expect(p.fetchCalls.length).toBe(0);
    expect(p.timers.length).toBe(1);
  });

  it("moves existing pickup/drop markers when coordinates change", async () => {
    const markers = [];
    const L = {
      map: () => ({ setView() { return this; }, fitBounds() {}, removeLayer() {} }),
      tileLayer: () => ({ addTo() {} }),
      divIcon: () => ({}),
      latLngBounds: (x) => x,
      polyline: () => ({ addTo() { return this; } }),
      marker(ll) {
        const m = { ll, sets: [], addTo() { return m; }, setLatLng(v) { m.sets.push(v); } };
        markers.push(m);
        return m;
      },
    };
    const snap = (plat, dlat) => ({
      state: "active", step: 1, poll_ms: 5000,
      pickup: { lat: plat, lng: 77, address: "a" }, drop: { lat: dlat, lng: 78, address: "b" },
    });
    const p = boot([snap(10, 20), snap(11, 21)], { L, tileUrl: "https://t/{z}/{x}/{y}.png" });
    await p.flush();
    expect(markers.length).toBe(2);
    p.timers[0].fn();
    await p.flush();
    expect(markers.length).toBe(2);
    expect(markers[0].sets).toEqual([[11, 77]]);
    expect(markers[1].sets).toEqual([[21, 78]]);
  });

  it("works with no window.L and no tiles", async () => {
    const p = boot([{ state: "active", step: 2, pickup: { lat: 1, lng: 2, address: "x" }, drop: null }]);
    await p.flush();
    expect(p.els.status.textContent).toBe("Driver reached the pickup point");
    expect(p.els.pickupAddr.textContent).toBe("x");
    expect(p.els.map.hidden).toBe(true);
  });
});
