jest.mock("../trackController", () => ({ snapshot: jest.fn(), page: jest.fn() }));
const { pageRouter, apiRouter } = require("../../routes/trackRoutes");

const paths = (router) => router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path} x${l.route.stack.length}`);

it("serves the page and the API on /:token, each behind a rate limiter", () => {
  expect(paths(pageRouter)).toEqual(["get /:token x2"]);
  expect(paths(apiRouter)).toEqual(["get /:token x2"]);
});
