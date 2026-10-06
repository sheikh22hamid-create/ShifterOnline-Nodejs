// backend/src/controllers/__tests__/trackPage.test.js
const { renderPage } = require("../trackPage");

const cfg = { tileUrl: "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=abcd1234", attribution: "<a>x</a>" };

describe("renderPage", () => {
  it("is a complete mobile document that is not indexed", () => {
    const html = renderPage(cfg);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain('name="robots" content="noindex"');
  });
  it("loads Leaflet 1.9.4 from cdnjs with the verified SRI hashes", () => {
    const html = renderPage(cfg);
    expect(html).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
    expect(html).toContain("sha256-XJrs/DDkVkUZ29zdzFOkGCJ9zHVo5hnpdi3c7HYJ7Uc=");
    expect(html).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
    expect(html).toContain("sha256-tXCrvaljxgtN5LT/Syb5Mm9T+yzPFGH98JVcoJT7JTk=");
  });
  it("pins each Leaflet URL to its OWN hash (the .min files, not the non-min ones)", () => {
    const html = renderPage(cfg);
    expect(html).toMatch(/<script[^>]*leaflet\.min\.js[^>]*integrity="sha256-XJrs\/DDkVkUZ29zdzFOkGCJ9zHVo5hnpdi3c7HYJ7Uc="/);
    expect(html).toMatch(/<link[^>]*leaflet\.min\.css[^>]*integrity="sha256-tXCrvaljxgtN5LT\/Syb5Mm9T\+yzPFGH98JVcoJT7JTk="/);
    expect(html).not.toContain("sha256-20nQCchB9co0qIjJZRGuk2");
    expect(html).not.toContain("sha256-p4NxAoJBhIIN+hmNHrzRCf9tD");
  });
  it("injects the config as inert JSON, escaping anything that could close the script tag", () => {
    const html = renderPage({ tileUrl: null, attribution: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script");
    const m = html.match(/<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/);
    expect(JSON.parse(m[1]).attribution).toBe("</script><script>alert(1)</script>");
  });
  it("never writes data into the page with innerHTML", () => {
    expect(renderPage(cfg)).not.toMatch(/innerHTML/);
  });
  it("keeps working without the map library or tiles", () => {
    const html = renderPage({ tileUrl: null, attribution: "" });
    expect(html).toMatch(/window\.L\b/);
    expect(html).toContain("CONFIG.tileUrl");
  });
  it("reads the token from the URL path and polls only the track API", () => {
    const html = renderPage(cfg);
    expect(html).toContain('"/api/track/"');
    expect(html).toContain("document.hidden");
  });
});
