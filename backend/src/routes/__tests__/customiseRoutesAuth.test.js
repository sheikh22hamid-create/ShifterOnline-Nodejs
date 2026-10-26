const appKeyAuth = require("../../middleware/appKeyAuth");
const riderRoutes = require("../riderRoutes");

const layerFor = (router, path) => router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);

describe("driver Customise Order routes", () => {
  it.each(["/customise/list", "/customise/count", "/customise/accept", "/customise/counter", "/customise/dismiss"])(
    "%s needs the app key", (path) => {
      const layer = layerFor(riderRoutes, path);
      expect(layer).toBeDefined();
      expect(layer.route.stack.map((s) => s.handle)).toContain(appKeyAuth);
    },
  );
});
