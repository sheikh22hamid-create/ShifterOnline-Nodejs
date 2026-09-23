const { create, update } = require("../rateCardController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => ({
  tbl_package: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  pkg_category: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

const VALID_BODY = {
  title: "Model 3",
  type: "DRIVER",
  cat_id: 8,
  city_id: "1",
  min_charge: "40",
  per_km_charge: "9",
  free_waiting_time: "5",
  waiting_charge: "2",
  start_time: "00:00",
  end_time: "00:00",
};

describe("rateCardController tier info fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_category.findUnique.mockResolvedValue({ id: 8, cat_name: "Bike" });
    prisma.tbl_package.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    prisma.tbl_package.findUnique.mockResolvedValue({ id: 1, cat_id: 8 });
    prisma.tbl_package.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, cat_id: 8, ...data }));
  });

  it("create persists both subtitles and the normalized sections JSON", async () => {
    const res = mockRes();
    await create({
      body: {
        ...VALID_BODY,
        driver_card_subtitle: "  Regular deliveries  ",
        driver_info_subtitle: "Steady earnings",
        driver_info_sections: [{ heading: " Earnings ", body: " Up to 20/km " }],
      },
    }, res);

    const data = prisma.tbl_package.create.mock.calls[0][0].data;
    expect(data.driver_card_subtitle).toBe("Regular deliveries");
    expect(data.driver_info_subtitle).toBe("Steady earnings");
    expect(JSON.parse(data.driver_info_sections)).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("create stores null when sections are absent or empty", async () => {
    const res = mockRes();
    await create({ body: { ...VALID_BODY, driver_info_sections: [] } }, res);
    expect(prisma.tbl_package.create.mock.calls[0][0].data.driver_info_sections).toBeNull();
  });

  it("create rejects malformed sections with a 400 and does not touch the database", async () => {
    const res = mockRes();
    await create({ body: { ...VALID_BODY, driver_info_sections: '{"a":1}' } }, res);
    expect(prisma.tbl_package.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining("array") })
    );
  });

  it("update persists the three fields", async () => {
    const res = mockRes();
    await update({
      params: { id: "1" },
      body: {
        driver_card_subtitle: "Long distance loads",
        driver_info_subtitle: "High value",
        driver_info_sections: [{ heading: "Example", body: "15 km trip" }],
      },
    }, res);

    const data = prisma.tbl_package.update.mock.calls[0][0].data;
    expect(data.driver_card_subtitle).toBe("Long distance loads");
    expect(data.driver_info_subtitle).toBe("High value");
    expect(JSON.parse(data.driver_info_sections)).toEqual([{ heading: "Example", body: "15 km trip" }]);
  });

  it("update rejects an over-long section body with a 400", async () => {
    const res = mockRes();
    await update({
      params: { id: "1" },
      body: { driver_info_sections: [{ heading: "H", body: "x".repeat(2001) }] },
    }, res);
    expect(prisma.tbl_package.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining("2000") })
    );
  });

  it("update clears a subtitle when an empty string is sent", async () => {
    const res = mockRes();
    await update({ params: { id: "1" }, body: { driver_card_subtitle: "" } }, res);
    expect(prisma.tbl_package.update.mock.calls[0][0].data.driver_card_subtitle).toBeNull();
  });

  // Code review finding: driver_card_subtitle/driver_info_subtitle are
  // VarChar(255) columns with no length check anywhere, so an over-long
  // value reaches MySQL and fails with a raw 500 instead of a readable 400
  // - the one field class in this feature that didn't get the same
  // boundary-input treatment as driver_info_sections.
  it("create rejects an over-long driver_card_subtitle with a 400 instead of hitting the database", async () => {
    const res = mockRes();
    await create({ body: { ...VALID_BODY, driver_card_subtitle: "x".repeat(256) } }, res);
    expect(prisma.tbl_package.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining("driver_card_subtitle") })
    );
  });

  it("create rejects an over-long driver_info_subtitle with a 400 instead of hitting the database", async () => {
    const res = mockRes();
    await create({ body: { ...VALID_BODY, driver_info_subtitle: "x".repeat(256) } }, res);
    expect(prisma.tbl_package.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining("driver_info_subtitle") })
    );
  });

  it("create accepts a subtitle at exactly the 255-character limit", async () => {
    const res = mockRes();
    await create({ body: { ...VALID_BODY, driver_card_subtitle: "x".repeat(255) } }, res);
    expect(prisma.tbl_package.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("update rejects an over-long driver_info_subtitle with a 400 and does not touch the database", async () => {
    const res = mockRes();
    await update({ params: { id: "1" }, body: { driver_info_subtitle: "x".repeat(256) } }, res);
    expect(prisma.tbl_package.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining("driver_info_subtitle") })
    );
  });

  it("returns driver_info_sections to the admin UI as a parsed array", async () => {
    const res = mockRes();
    await update({
      params: { id: "1" },
      body: { driver_info_sections: [{ heading: "Earnings", body: "Up to 20/km" }] },
    }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.driver_info_sections).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
  });
});
