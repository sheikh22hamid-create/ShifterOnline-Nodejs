const { generateModels } = require("../../controllers/rateCardController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => ({
  tbl_package: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  pkg_category: {
    findUnique: jest.fn(),
  },
}));

describe("rateCardController.generateModels", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("fails if baseRateCardId is missing", async () => {
    const req = { body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await generateModels(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining("baseRateCardId") }));
  });

  it("fails if base rate card not found", async () => {
    prisma.tbl_package.findUnique.mockResolvedValue(null);
    const req = { body: { baseRateCardId: 999, models: [{ title: "Model 1", offset_percent: -10 }] } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await generateModels(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: "Base rate card not found" }));
  });

  it("auto-generates missing models with calculated fares and inherited settings", async () => {
    const mockBase = {
      id: 30,
      title: "Model 3",
      user_title: "Comfort",
      driver_title: "Prime Tier",
      type: "USER",
      cat_id: 8,
      city_id: "1",
      min_charge: "100.00",
      per_km_charge: "10.00",
      pickup_per_km_charge: "5.00",
      free_waiting_time: 5,
      waiting_charge: "2.00",
      driver_per_percent: "80",
      status: 1,
      start_time: new Date("1970-01-01T23:00:00.000Z"),
      end_time: new Date("1970-01-01T06:00:00.000Z"),
    };

    prisma.tbl_package.findUnique.mockResolvedValue(mockBase);
    prisma.pkg_category.findUnique.mockResolvedValue({ id: 8, cat_name: "Bike" });
    prisma.tbl_package.findFirst.mockResolvedValue(null); // Not existing yet
    prisma.tbl_package.create.mockImplementation(({ data }) => Promise.resolve({ id: Math.floor(Math.random() * 1000), ...data }));

    const req = {
      body: {
        baseRateCardId: 30,
        models: [
          { title: "Model 1", user_title: "Super Saver", driver_title: "Standard Tier", offset_percent: -13 },
          { title: "Model 4", user_title: "Express", driver_title: "Gold Beast", offset_percent: 20 },
        ],
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await generateModels(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.tbl_package.create).toHaveBeenCalledTimes(2);

    // Model 1: min 100 * (1 - 0.13) = 87, per_km 10 * 0.87 = 8.7
    expect(prisma.tbl_package.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: "Model 1",
        min_charge: "87",
        per_km_charge: "8.7",
        pickup_per_km_charge: "4.35",
        free_waiting_time: 5,
        waiting_charge: "2.00",
        driver_per_percent: "80",
        type: "USER",
        cat_id: 8,
      }),
    }));

    // Model 4: min 100 * (1 + 0.20) = 120, per_km 10 * 1.20 = 12
    expect(prisma.tbl_package.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: "Model 4",
        min_charge: "120",
        per_km_charge: "12",
        pickup_per_km_charge: "6",
        free_waiting_time: 5,
        type: "USER",
        cat_id: 8,
      }),
    }));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      createdCount: 2,
      updatedCount: 0,
    }));
  });

  it("updates existing model if already present in database", async () => {
    const mockBase = {
      id: 30,
      title: "Model 3",
      type: "USER",
      cat_id: 8,
      city_id: "1",
      min_charge: "200.00",
      per_km_charge: "20.00",
      free_waiting_time: 5,
      waiting_charge: "2.00",
      driver_per_percent: "80",
      status: 1,
    };

    const mockExistingM1 = {
      id: 45,
      title: "Model 1",
      cat_id: 8,
      city_id: "1",
      type: "USER",
      user_title: "Old Title",
    };

    prisma.tbl_package.findUnique.mockResolvedValue(mockBase);
    prisma.pkg_category.findUnique.mockResolvedValue({ id: 8, cat_name: "Bike" });
    prisma.tbl_package.findFirst.mockResolvedValue(mockExistingM1); // Exists
    prisma.tbl_package.update.mockImplementation(({ data }) => Promise.resolve({ ...mockExistingM1, ...data }));

    const req = {
      body: {
        baseRateCardId: 30,
        models: [
          { title: "Model 1", user_title: "Super Saver", offset_percent: -10 },
        ],
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await generateModels(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.tbl_package.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 45 },
      data: expect.objectContaining({
        min_charge: "180",
        per_km_charge: "18",
        user_title: "Super Saver",
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      createdCount: 0,
      updatedCount: 1,
    }));
  });
});
