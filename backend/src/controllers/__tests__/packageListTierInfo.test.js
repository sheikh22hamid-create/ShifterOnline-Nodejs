const { packageListForDriver } = require("../riderController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  pkg_category: { findFirst: jest.fn() },
  tbl_package: { findMany: jest.fn() },
  tbl_rider_delivery_type: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

async function callWith(packages) {
  prisma.tbl_rider.findUnique.mockResolvedValue({ vehicle: "Bike" });
  prisma.pkg_category.findFirst.mockResolvedValue({ id: 8, cat_name: "Bike" });
  prisma.tbl_package.findMany.mockResolvedValue(packages);
  prisma.tbl_rider_delivery_type.findMany.mockResolvedValue([]);
  const res = mockRes();
  await packageListForDriver({ body: { uid: 7 } }, res);
  return res.json.mock.calls[0][0];
}

const BASE_PKG = {
  id: 21,
  title: "Model 3",
  user_title: "Comfort",
  driver_title: "Prime Tier",
  driver_detail_image: null,
  user_detail_image: null,
  per_km_charge: "10.34",
  min_charge: "46.2",
};

describe("packageListForDriver tier info", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the subtitles and parsed sections", async () => {
    const payload = await callWith([
      {
        ...BASE_PKG,
        driver_card_subtitle: "High demand & priority trips",
        driver_info_subtitle: "Premium deliveries",
        driver_info_sections: '[{"heading":"Earnings","body":"Up to 22/km"}]',
      },
    ]);

    expect(payload.PackageData[0].driver_card_subtitle).toBe("High demand & priority trips");
    expect(payload.PackageData[0].driver_info_subtitle).toBe("Premium deliveries");
    expect(payload.PackageData[0].driver_info_sections).toEqual([
      { heading: "Earnings", body: "Up to 22/km" },
    ]);
  });

  it("returns empty string / empty array when the columns are null", async () => {
    const payload = await callWith([
      { ...BASE_PKG, driver_card_subtitle: null, driver_info_subtitle: null, driver_info_sections: null },
    ]);

    expect(payload.PackageData[0].driver_card_subtitle).toBe("");
    expect(payload.PackageData[0].driver_info_subtitle).toBe("");
    expect(payload.PackageData[0].driver_info_sections).toEqual([]);
  });

  it("degrades malformed stored JSON to an empty array without failing the whole list", async () => {
    const payload = await callWith([
      { ...BASE_PKG, id: 21, driver_info_sections: "{not json" },
      { ...BASE_PKG, id: 22, driver_info_sections: '[{"heading":"Ok","body":"Fine"}]' },
    ]);

    expect(payload.Result).toBe("true");
    expect(payload.PackageData).toHaveLength(2);
    expect(payload.PackageData[0].driver_info_sections).toEqual([]);
    expect(payload.PackageData[1].driver_info_sections).toEqual([{ heading: "Ok", body: "Fine" }]);
  });

  it("carries a subtitle with no sections, and sections with no subtitle, independently", async () => {
    const payload = await callWith([
      { ...BASE_PKG, id: 21, driver_info_subtitle: "Premium deliveries", driver_info_sections: null },
      { ...BASE_PKG, id: 22, driver_info_subtitle: null, driver_info_sections: '[{"heading":"Ok","body":"Fine"}]' },
    ]);

    // The app shows its Details chip when EITHER of these is non-empty, so
    // neither may be flattened away when the other is missing.
    expect(payload.PackageData[0].driver_info_subtitle).toBe("Premium deliveries");
    expect(payload.PackageData[0].driver_info_sections).toEqual([]);
    expect(payload.PackageData[1].driver_info_subtitle).toBe("");
    expect(payload.PackageData[1].driver_info_sections).toEqual([{ heading: "Ok", body: "Fine" }]);
  });

  it("selects and returns the real user_title instead of falling back to title", async () => {
    const payload = await callWith([BASE_PKG]);
    expect(prisma.tbl_package.findMany.mock.calls[0][0].select.user_title).toBe(true);
    expect(payload.PackageData[0].user_title).toBe("Comfort");
  });

  it("selects the three tier info columns", async () => {
    await callWith([BASE_PKG]);
    const select = prisma.tbl_package.findMany.mock.calls[0][0].select;
    expect(select.driver_card_subtitle).toBe(true);
    expect(select.driver_info_subtitle).toBe(true);
    expect(select.driver_info_sections).toBe(true);
  });
});
