// backend/src/controllers/__tests__/helpers/trackPageHarness.js
// Runs the tracking page script against a minimal hand-written fake DOM (jsdom is not installed and must
// not be added as a dependency). Not a test file: jest only picks up *.test.js.
const { renderPage } = require("../../trackPage");

function makeEl() {
  const el = {
    hidden: false, href: "", className: "", children: [], style: {}, value: "", disabled: false, type: "",
    attrs: {}, handlers: {},
    classList: { add() {}, remove() {} },
    appendChild(c) { el.children.push(c); return c; },
    setAttribute(k, v) { el.attrs[k] = v; },
    addEventListener(ev, fn) { el.handlers[ev] = fn; },
    click() { if (el.handlers.click) el.handlers.click(); },
  };
  Object.defineProperty(el, "textContent", {
    get() { return el._t || ""; },
    set(v) { el._t = String(v); if (v === "") el.children = []; },
  });
  return el;
}

// snapshots: array of GET /api/track/<token> bodies (the last one repeats). opts.postReplies maps the last
// path segment of a POST ("review", "pay-link") to { status, body } or an Error (default: 200 {ok:true}).
function boot(snapshots, opts = {}) {
  const html = renderPage({ tileUrl: opts.tileUrl || null, attribution: "" });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const els = new Proxy({}, {
    get(target, prop) {
      if (typeof prop === "string" && !(prop in target)) target[prop] = makeEl();
      return target[prop];
    },
  });
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
  const posts = [];
  const location = { pathname: "/track/abc123", href: "" };
  let i = 0;
  const fetchStub = (url, init) => {
    if (init && init.method === "POST") {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      const reply = (opts.postReplies || {})[String(url).split("/").pop()] || { status: 200, body: { ok: true } };
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({ status: reply.status || 200, json: () => Promise.resolve(reply.body) });
    }
    fetchCalls.push(url);
    const body = snapshots[Math.min(i++, snapshots.length - 1)];
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve({ status: body && body.__status ? body.__status : 200, json: () => Promise.resolve(body) });
  };
  const win = opts.L ? { L: opts.L } : {};
  // requestAnimationFrame does not exist in node: the marker animation is a no-op here.
  new Function("document", "location", "fetch", "setTimeout", "clearTimeout", "window", "L", "requestAnimationFrame", "cancelAnimationFrame", script)(
    document, location, fetchStub,
    (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, win, opts.L,
    () => 1, () => {}
  );
  const flush = () => new Promise((r) => setImmediate(r));
  return { els, timers, fetchCalls, posts, location, flush, document };
}

module.exports = { boot, makeEl };
