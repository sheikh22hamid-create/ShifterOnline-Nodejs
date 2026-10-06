// backend/src/controllers/__tests__/trackPageDelivered.test.js
const { boot } = require("./helpers/trackPageHarness");

const delivered = (extra = {}) => ({
  state: "delivered", order_id: 489, step: 5, delivered_at: "2026-10-06T15:00:00.000+05:30", poll_ms: 15000,
  summary: { driver: { first_name: "Ravi", vehicle_no: "MP09AB1234" }, pickup: { address: "Pickup road" }, drop: { address: "Drop road" }, distance_km: 4.3 },
  trip_route: null, pay: null, review: { submitted: false },
  help: { phone: "9109114515", whatsapp: "919109114515" }, app_url: "https://play.google.com/store/apps/details?id=com.shifter.online",
  ...extra,
});

describe("delivered screen", () => {
  it("renders the summary as text only and stops polling", async () => {
    const p = boot([delivered({ summary: { driver: { first_name: "<b>Ravi</b>", vehicle_no: "X1" }, pickup: { address: "<i>a</i>" }, drop: { address: "b" }, distance_km: 4.3 } })]);
    await p.flush();
    expect(p.els.status.textContent).toBe("Delivered");
    expect(p.els.summaryCard.hidden).toBe(false);
    expect(p.els.sumDriver.textContent).toBe("<b>Ravi</b> · X1");
    expect(p.els.sumPickup.textContent).toBe("<i>a</i>");
    expect(p.els.sumDistance.textContent).toBe("4.3 km");
    expect(p.timers.length).toBe(0);
  });
  it("shows dashes for missing summary parts", async () => {
    const p = boot([delivered({ summary: { driver: null, pickup: null, drop: null, distance_km: null } })]);
    await p.flush();
    expect(p.els.sumDriver.textContent).toBe("—");
    expect(p.els.sumDistance.textContent).toBe("—");
  });
  it("help links are digit-sanitised and the app button needs https", async () => {
    const p = boot([delivered({ help: { phone: "91 09-114515;x", whatsapp: "91 9109114515" }, app_url: "javascript:alert(1)" })]);
    await p.flush();
    expect(p.els.helpCard.hidden).toBe(false);
    expect(p.els.helpCall.href).toBe("tel:9109114515");
    expect(p.els.helpWa.href).toBe("https://wa.me/919109114515?text=" + encodeURIComponent("Order #489 - I need help"));
    expect(p.els.appBtn.hidden).toBe(true);
    const ok = boot([delivered()]);
    await ok.flush();
    expect(ok.els.appBtn.hidden).toBe(false);
    expect(ok.els.appBtn.href).toBe("https://play.google.com/store/apps/details?id=com.shifter.online");
  });
  it("a cancelled or expired link shows none of the delivered cards", async () => {
    for (const state of ["cancelled", "expired", "invalid"]) {
      const q = boot([{ state, order_id: 489 }]);
      await q.flush();
      for (const id of ["summaryCard", "payCard", "reviewCard", "thanksCard", "helpCard", "appBtn"]) expect(q.els[id].hidden).toBe(true);
    }
  });
});

describe("pay card", () => {
  const payable = { state: "payable", amount_due: 100, markup: 3, total: 103 };
  it("no pay card without a pay block", async () => {
    const p = boot([delivered()]);
    await p.flush();
    expect(p.els.payCard.hidden).toBe(true);
  });
  it("shows fare, fee and total and a Pay button", async () => {
    const p = boot([delivered({ pay: payable })]);
    await p.flush();
    expect(p.els.payCard.hidden).toBe(false);
    expect(p.els.payFare.textContent).toBe("₹100.00");
    expect(p.els.payFeeRow.hidden).toBe(false);
    expect(p.els.payFee.textContent).toBe("₹3.00");
    expect(p.els.payTotal.textContent).toBe("₹103.00");
    expect(p.els.payBtn.hidden).toBe(false);
    expect(p.els.paidNote.hidden).toBe(true);
  });
  it("hides the fee row when there is no fee", async () => {
    const p = boot([delivered({ pay: { ...payable, markup: 0, total: 100 } })]);
    await p.flush();
    expect(p.els.payFeeRow.hidden).toBe(true);
  });
  it("a paid order shows Paid and no button", async () => {
    const p = boot([delivered({ pay: { ...payable, state: "paid" } })]);
    await p.flush();
    expect(p.els.payBtn.hidden).toBe(true);
    expect(p.els.paidNote.hidden).toBe(false);
  });
  it("Pay now posts once and redirects to the pay page; a second click does nothing", async () => {
    const p = boot([delivered({ pay: payable })], { postReplies: { "pay-link": { status: 200, body: { ok: true, url: "https://api.example.com/pay/tok" } } } });
    await p.flush();
    p.els.payBtn.click();
    p.els.payBtn.click();
    await p.flush();
    expect(p.posts).toEqual([{ url: "/api/track/abc123/pay-link", body: {} }]);
    expect(p.location.href).toBe("https://api.example.com/pay/tok");
    expect(p.els.payBtn.disabled).toBe(true);
  });
  it("never follows a non-http(s) url", async () => {
    const p = boot([delivered({ pay: payable })], { postReplies: { "pay-link": { status: 200, body: { ok: true, url: "javascript:alert(1)" } } } });
    await p.flush();
    p.els.payBtn.click();
    await p.flush();
    expect(p.location.href).toBe("");
    expect(p.els.payMsg.textContent).not.toBe("");
    expect(p.els.payBtn.disabled).toBe(false);
  });
  it("shows the server message and re-enables the button on failure", async () => {
    const p = boot([delivered({ pay: payable })], { postReplies: { "pay-link": { status: 503, body: { ok: false, code: "NOT_CONFIGURED", message: "Payment link is not available right now." } } } });
    await p.flush();
    p.els.payBtn.click();
    await p.flush();
    expect(p.els.payMsg.textContent).toBe("Payment link is not available right now.");
    expect(p.els.payBtn.disabled).toBe(false);
    expect(p.location.href).toBe("");
  });
  it("a network error also re-enables the button", async () => {
    const p = boot([delivered({ pay: payable })], { postReplies: { "pay-link": new Error("down") } });
    await p.flush();
    p.els.payBtn.click();
    await p.flush();
    expect(p.els.payMsg.textContent).toMatch(/try again/i);
    expect(p.els.payBtn.disabled).toBe(false);
  });
});

describe("review form", () => {
  it("is shown until a review exists, then a thank-you replaces it", async () => {
    const open = boot([delivered()]);
    await open.flush();
    expect(open.els.reviewCard.hidden).toBe(false);
    expect(open.els.thanksCard.hidden).toBe(true);
    expect(open.els.starsDriver.children.length).toBe(5);
    expect(open.els.starsDelivery.children.length).toBe(5);
    const done = boot([delivered({ review: { submitted: true } })]);
    await done.flush();
    expect(done.els.reviewCard.hidden).toBe(true);
    expect(done.els.thanksCard.hidden).toBe(false);
  });
  it("needs a rating before it posts", async () => {
    const p = boot([delivered()]);
    await p.flush();
    p.els.reviewBtn.click();
    await p.flush();
    expect(p.posts).toEqual([]);
    expect(p.els.reviewMsg.textContent).toMatch(/rating/i);
  });
  it("positive tags for 4-5 stars, negative tags for 1-3", async () => {
    const p = boot([delivered()]);
    await p.flush();
    p.els.starsDriver.children[4].click();
    expect(p.els.tags.children.map((c) => c.textContent)).toContain("Safe Driving");
    p.els.starsDriver.children[1].click();
    const labels = p.els.tags.children.map((c) => c.textContent);
    expect(labels).toContain("Rash Driving");
    expect(labels).not.toContain("Safe Driving");
  });
  it("posts ratings, tags and comment once and then thanks the receiver", async () => {
    const p = boot([delivered()]);
    await p.flush();
    p.els.starsDriver.children[4].click();
    p.els.starsDelivery.children[3].click();
    p.els.tags.children.find((c) => c.textContent === "Safe Driving").click();
    p.els.comment.value = "Great driver";
    p.els.reviewBtn.click();
    p.els.reviewBtn.click();
    await p.flush();
    expect(p.posts).toEqual([{ url: "/api/track/abc123/review", body: { driver_rating: 5, delivery_rating: 4, tags: ["Safe Driving"], comment: "Great driver" } }]);
    expect(p.els.reviewCard.hidden).toBe(true);
    expect(p.els.thanksCard.hidden).toBe(false);
  });
  it("treats 409 ALREADY_SUBMITTED as done", async () => {
    const p = boot([delivered()], { postReplies: { review: { status: 409, body: { ok: false, code: "ALREADY_SUBMITTED", message: "dup" } } } });
    await p.flush();
    p.els.starsDriver.children[4].click();
    p.els.reviewBtn.click();
    await p.flush();
    expect(p.els.thanksCard.hidden).toBe(false);
  });
  it("keeps the form and shows the message on a server error", async () => {
    const p = boot([delivered()], { postReplies: { review: { status: 500, body: { ok: false, code: "ERROR", message: "Something went wrong. Please try again." } } } });
    await p.flush();
    p.els.starsDriver.children[4].click();
    p.els.reviewBtn.click();
    await p.flush();
    expect(p.els.reviewCard.hidden).toBe(false);
    expect(p.els.reviewMsg.textContent).toBe("Something went wrong. Please try again.");
    expect(p.els.reviewBtn.disabled).toBe(false);
  });
});

describe("trip route map", () => {
  function makeL() {
    const calls = { markers: [], lines: [], removed: [], bounds: 0 };
    const L = {
      map: () => ({ setView() { return this; }, fitBounds() { calls.bounds += 1; }, removeLayer(l) { calls.removed.push(l); } }),
      tileLayer: () => ({ addTo() {} }),
      divIcon: () => ({}),
      latLng: (lat, lng) => ({ lat, lng }),
      latLngBounds: (x) => x,
      polyline(pts) { const l = { pts, addTo() { return l; } }; calls.lines.push(l); return l; },
      marker(ll) { const m = { ll, sets: [], addTo() { return m; }, setLatLng(v) { m.sets.push(v); }, getElement() { return null; }, getLatLng() { return { lat: ll[0], lng: ll[1] }; } }; calls.markers.push(m); return m; },
    };
    return { L, calls };
  }
  const tiles = "https://t/{z}/{x}/{y}.png";
  const route = { has_trail: true, points: [[1, 2], [3, 4], [5, 6]], pickup: { lat: 1, lng: 2 }, drop: { lat: 5, lng: 6 } };

  it("draws the driven route and the pins, and shows the map", async () => {
    const { L, calls } = makeL();
    const p = boot([delivered({ trip_route: route })], { L, tileUrl: tiles });
    await p.flush();
    expect(p.els.map.hidden).toBe(false);
    expect(calls.lines).toHaveLength(1);
    expect(calls.lines[0].pts).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(calls.markers).toHaveLength(2);
    expect(calls.bounds).toBe(1);
  });
  it("without a trail it shows just the pins", async () => {
    const { L, calls } = makeL();
    const p = boot([delivered({ trip_route: { has_trail: false, points: [], pickup: { lat: 1, lng: 2 }, drop: { lat: 5, lng: 6 } } })], { L, tileUrl: tiles });
    await p.flush();
    expect(calls.lines).toHaveLength(0);
    expect(calls.markers).toHaveLength(2);
  });
  it("removes the live driver marker and live route when the order turns delivered", async () => {
    const { L, calls } = makeL();
    const live = { state: "active", step: 3, poll_ms: 5000, pickup: { lat: 1, lng: 2, address: "a" }, drop: { lat: 5, lng: 6, address: "b" }, route: [[1, 2], [5, 6]], position: { lat: 3, lng: 4, heading: 0, stale: false }, driver: { first_name: "R", phone: "1" } };
    const p = boot([live, delivered({ trip_route: route })], { L, tileUrl: tiles });
    await p.flush();
    p.timers[0].fn();
    await p.flush();
    expect(calls.removed.length).toBeGreaterThanOrEqual(2); // live route line and driver marker
  });
  it("works without Leaflet: the other blocks still render and the map stays hidden", async () => {
    const p = boot([delivered({ trip_route: route, pay: { state: "payable", amount_due: 1, markup: 0, total: 1 } })]);
    await p.flush();
    expect(p.els.map.hidden).toBe(true);
    expect(p.els.summaryCard.hidden).toBe(false);
    expect(p.els.payCard.hidden).toBe(false);
  });
});
