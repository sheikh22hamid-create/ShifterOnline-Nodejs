jest.mock("../../utils/addressTitle", () => ({
  resolveLocationTitle: jest.fn(),
  sanitizeTitle: jest.fn((v) => (typeof v === "string" && v.trim() ? v.trim() : null)),
}));
const { resolveLocationTitle } = require("../../utils/addressTitle");
const { resolveSideTitle, resolveOrderTitles } = require("../orderAreaTitles");

describe("orderAreaTitles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("resolves pickup and drop in parallel, each once", async () => {
    resolveLocationTitle.mockImplementation(async (lat) => (lat === 1 ? "Khajrana" : "Vijay Nagar"));
    const r = await resolveOrderTitles({ plat: 1, plong: 2, dlat: 3, dlong: 4 });
    expect(r).toEqual({ pickup_title: "Khajrana", drop_title: "Vijay Nagar" });
    expect(resolveLocationTitle).toHaveBeenCalledTimes(2);
    expect(resolveLocationTitle).toHaveBeenCalledWith(1, 2);
    expect(resolveLocationTitle).toHaveBeenCalledWith(3, 4);
  });

  test("client title wins without a lookup", async () => {
    resolveLocationTitle.mockResolvedValue("Geo");
    expect(await resolveSideTitle(1, 2, "  Palasia ")).toBe("Palasia");
    expect(resolveLocationTitle).not.toHaveBeenCalled();
    const r = await resolveOrderTitles({
      plat: 1, plong: 2, dlat: 3, dlong: 4, clientPickupTitle: "A",
    });
    expect(r).toEqual({ pickup_title: "A", drop_title: "Geo" });
    expect(resolveLocationTitle).toHaveBeenCalledTimes(1);
  });

  test("blank client title falls back to lookup", async () => {
    resolveLocationTitle.mockResolvedValue("Geo");
    expect(await resolveSideTitle(1, 2, "   ")).toBe("Geo");
  });

  test.each([[NaN, 1], [1, undefined], [null, null], ["abc", 2], [Infinity, 1]])(
    "non-finite coordinates (%p,%p) -> null without lookup",
    async (a, b) => {
      expect(await resolveSideTitle(a, b)).toBeNull();
      expect(resolveLocationTitle).not.toHaveBeenCalled();
    }
  );

  test("resolver returning null -> null", async () => {
    resolveLocationTitle.mockResolvedValue(null);
    expect(await resolveSideTitle(1, 2)).toBeNull();
  });

  test("inputs are not mutated and coordinates are not returned", async () => {
    resolveLocationTitle.mockResolvedValue("X");
    const input = { plat: "22.7196", plong: "75.8577", dlat: 22.7, dlong: 75.9 };
    const copy = { ...input };
    const r = await resolveOrderTitles(input);
    expect(input).toEqual(copy);
    expect(Object.keys(r).sort()).toEqual(["drop_title", "pickup_title"]);
    expect(resolveLocationTitle).toHaveBeenCalledWith("22.7196", "75.8577");
  });
});
