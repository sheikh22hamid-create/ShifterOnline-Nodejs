const { create } = require("../adminRiderController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => {
  const mockTx = {
    tbl_rider: {
      create: jest.fn(),
    },
    tbl_personal_doc: {
      create: jest.fn(),
    },
    tbl_vehicle_details: {
      create: jest.fn(),
    },
    tbl_bank_account: {
      create: jest.fn(),
    },
    tbl_package: {
      findMany: jest.fn(),
    },
    tbl_rider_delivery_type: {
      createMany: jest.fn(),
    },
  };

  return {
    tbl_rider: {
      findFirst: jest.fn(),
    },
    pkg_category: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (cb) => cb(mockTx)),
    __mockTx: mockTx,
  };
});

jest.mock("../riderAuthController", () => ({
  uniqueRefferCode: jest.fn().mockResolvedValue("REF12345"),
}));

jest.mock("../../sockets/adminSocket", () => ({
  notifyDriverStatusUpdate: jest.fn(),
}));

describe("adminRiderController.create", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("validates required fields", async () => {
    const req = { body: {}, user: { id: 1, role: "superadmin" } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining("full name") }));
  });

  it("fails if mobile number is already registered", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 5, full_name: "Existing Driver" });
    const req = {
      body: {
        full_name: "Raju Kumar",
        fmobile: "9876543210",
        vehicle: "Bike",
        vehicle_no: "MP09AB1234",
        city_id: 1,
      },
      user: { id: 1, role: "superadmin" },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining("already exists") }));
  });

  it("creates driver with Approved status and all documents/models", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    prisma.pkg_category.findMany.mockResolvedValue([{ id: 1, cat_name: "Bike" }]);

    const createdRiderMock = {
      id: 99,
      full_name: "Raju Kumar",
      fmobile: "9876543210",
      vehicle: "Bike",
      vehicle_no: "MP09AB1234",
      verification_status: "approved",
    };
    prisma.__mockTx.tbl_rider.create.mockResolvedValue(createdRiderMock);
    prisma.__mockTx.tbl_personal_doc.create.mockResolvedValue({ id: 1 });
    prisma.__mockTx.tbl_vehicle_details.create.mockResolvedValue({ id: 1 });
    prisma.__mockTx.tbl_bank_account.create.mockResolvedValue({ id: 1 });
    prisma.__mockTx.tbl_package.findMany.mockResolvedValue([{ id: 101 }, { id: 102 }]);
    prisma.__mockTx.tbl_rider_delivery_type.createMany.mockResolvedValue({ count: 2 });

    const req = {
      body: {
        full_name: "Raju Kumar",
        fmobile: "9876543210",
        dob: "1995-05-12",
        vehicle: "Bike",
        vehicle_no: "MP09AB1234",
        city_id: 1,
        aadhar_id: "123456789012",
        pan_id: "ABCDE1234F",
        lic_id: "DL-1234567890",
        rc_number: "MP09AB1234",
        account_name: "Raju Kumar",
        account_number: "987654321012",
        ifsc: "SBIN0001234",
        verification_status: "approved",
      },
      user: { id: 1, role: "superadmin" },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: 99,
          full_name: "Raju Kumar",
          verification_status: "approved",
        }),
      })
    );

    // Verify tbl_rider creation
    expect(prisma.__mockTx.tbl_rider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          full_name: "Raju Kumar",
          fmobile: "9876543210",
          all_verify: 1,
          verification_status: "approved",
          payment_complete: 1,
        }),
      })
    );

    // Verify tbl_personal_doc creation with doc numbers & approved status
    expect(prisma.__mockTx.tbl_personal_doc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aadhar_id: "123456789012",
          aadhar_status: 1,
          pan_id: "ABCDE1234F",
          pan_status: 1,
          lic_id: "DL-1234567890",
          lic_status: 1,
          residence_id: "MP09AB1234",
          residence_status: 1,
        }),
      })
    );

    // Verify models auto-enabled
    expect(prisma.__mockTx.tbl_rider_delivery_type.createMany).toHaveBeenCalledWith({
      data: [
        { rider_id: 99, delivery_type: "101", status: 1 },
        { rider_id: 99, delivery_type: "102", status: 1 },
      ],
    });
  });
});
