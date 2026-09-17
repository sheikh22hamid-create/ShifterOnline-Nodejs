jest.mock("../../config/db", () => ({
  pkg_category: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
}));

const prisma = require("../../config/db");
const { createCategory, updateCategory } = require("../masterDataController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("masterDataController category detail specs", () => {
  beforeEach(() => jest.clearAllMocks());

  it("createCategory persists detail-spec fields when provided", async () => {
    prisma.pkg_category.create.mockResolvedValue({ id: 1 });
    const req = {
      body: {
        cat_name: "Bike", cat_img: "images/category/bike.png",
        max_load_kg: 20, dim_length: 1.5, dim_width: 1, dim_height: 1,
        dim_unit: "ft", detail_image: "images/category/bike_detail.png",
      },
    };

    await createCategory(req, makeRes());

    expect(prisma.pkg_category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        max_load_kg: 20, dim_length: 1.5, dim_width: 1, dim_height: 1,
        dim_unit: "ft", detail_image: "images/category/bike_detail.png",
      }),
    });
  });

  it("createCategory defaults detail-spec fields to null when omitted", async () => {
    prisma.pkg_category.create.mockResolvedValue({ id: 1 });
    const req = { body: { cat_name: "Bike", cat_img: "images/category/bike.png" } };

    await createCategory(req, makeRes());

    expect(prisma.pkg_category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        max_load_kg: null, dim_length: null, dim_width: null,
        dim_height: null, dim_unit: null, detail_image: null,
      }),
    });
  });

  it("updateCategory only writes detail-spec fields that are present in the request", async () => {
    prisma.pkg_category.findUnique.mockResolvedValue({ id: 1, cat_name: "Bike" });
    prisma.pkg_category.update.mockResolvedValue({ id: 1 });
    const req = { params: { id: "1" }, body: { max_load_kg: 25 } };

    await updateCategory(req, makeRes());

    const data = prisma.pkg_category.update.mock.calls[0][0].data;
    expect(data.max_load_kg).toBe(25);
    expect(data).not.toHaveProperty("dim_length");
    expect(data).not.toHaveProperty("detail_image");
  });
});
