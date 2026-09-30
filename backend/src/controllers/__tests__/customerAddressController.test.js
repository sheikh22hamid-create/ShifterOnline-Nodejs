const { addressList, saveAddress, deleteAddress } = require("../customerProfileController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => ({
  tbl_address: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  tbl_user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

describe("customerProfileController - Address APIs", () => {
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe("addressList", () => {
    it("returns 200 with empty list when user has no saved addresses (no 401 error)", async () => {
      prisma.tbl_address.findMany.mockResolvedValue([]);

      const req = { body: { uid: 12 } };
      await addressList(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        ResponseCode: "200",
        Result: "true",
        ResponseMsg: "Address List Not Found!!",
        AddressList: [],
      });
    });

    it("returns 200 with mapped addresses when user has addresses", async () => {
      prisma.tbl_address.findMany.mockResolvedValue([
        {
          id: 1,
          uid: 12,
          houseno: "101",
          address: "Sector 62, Noida",
          c_name: "Test User",
          c_number: "9876543210",
          lat_map: "28.6139",
          long_map: "77.3653",
          landmark: "Near Metro",
          type: "Home",
          is_tracking: 0,
        },
      ]);

      const req = { body: { uid: 12 } };
      await addressList(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        ResponseCode: "200",
        Result: "true",
        ResponseMsg: "Address List Get Successfully!!!",
        AddressList: [
          {
            id: 1,
            uid: 12,
            hno: "101",
            address: "Sector 62, Noida",
            c_name: "Test User",
            c_number: "9876543210",
            lat_map: "28.6139",
            long_map: "77.3653",
            landmark: "Near Metro",
            type: "Home",
            is_tracking: 0,
          },
        ],
      });
    });
  });

  describe("saveAddress", () => {
    it("successfully creates a new address when aid is null/omitted without failing", async () => {
      prisma.tbl_user.findFirst.mockResolvedValue({ id: 12, name: "Test User", mobile: "9876543210", status: 1 });
      prisma.tbl_address.create.mockResolvedValue({
        id: 5,
        uid: 12,
        address: "Connaught Place, Delhi",
        houseno: "B-12",
        landmark: "Block B",
        type: "Office",
        lat_map: "28.6315",
        long_map: "77.2167",
        c_name: "Test User",
        c_number: "9876543210",
        is_tracking: 0,
      });

      const req = {
        body: {
          uid: "12",
          address: "Connaught Place, Delhi",
          houseno: "B-12",
          landmark: "Block B",
          type: "Office",
          lat_map: 28.6315,
          long_map: 77.2167,
          aid: null,
          c_name: "Test User",
          c_number: "9876543210",
        },
      };

      await saveAddress(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ResponseCode: "200",
          Result: "true",
          ResponseMsg: "Address Saved Successfully!!!",
          AddressData: expect.objectContaining({
            id: 5,
            uid: 12,
            hno: "B-12",
            address: "Connaught Place, Delhi",
          }),
        })
      );
    });
  });

  describe("deleteAddress", () => {
    it("deletes the address for the user", async () => {
      prisma.tbl_address.deleteMany.mockResolvedValue({ count: 1 });

      const req = { body: { uid: 12, aid: 5 } };
      await deleteAddress(req, res);

      expect(prisma.tbl_address.deleteMany).toHaveBeenCalledWith({ where: { id: 5, uid: 12 } });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        ResponseCode: "200",
        Result: "true",
        ResponseMsg: "Address Deleted Successfully!!!",
      });
    });
  });

  describe("autoSaveOrderAddress (from orderController)", () => {
    const { autoSaveOrderAddress } = require("../orderController");

    it("auto-saves pickup/drop address if not already present", async () => {
      prisma.tbl_address.findFirst.mockResolvedValue(null);
      prisma.tbl_address.create.mockResolvedValue({ id: 99, uid: 12, address: "Malviya Nagar, Jaipur" });

      const saved = await autoSaveOrderAddress({
        uid: 12,
        address: "Malviya Nagar, Jaipur",
        lat: 26.85,
        lng: 75.82,
        type: "Home",
        contactName: "John Doe",
        contactNumber: "9876543210",
      });

      expect(prisma.tbl_address.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            uid: 12,
            address: "Malviya Nagar, Jaipur",
            type: "Home",
            lat_map: "26.85",
            long_map: "75.82",
            c_name: "John Doe",
            c_number: "9876543210",
          }),
        })
      );
      expect(saved).toEqual(expect.objectContaining({ id: 99 }));
    });

    it("does not create duplicate address if already exists for user", async () => {
      prisma.tbl_address.findFirst.mockResolvedValue({ id: 50, uid: 12, address: "Malviya Nagar, Jaipur" });

      const res = await autoSaveOrderAddress({
        uid: 12,
        address: "Malviya Nagar, Jaipur",
        lat: 26.85,
        lng: 75.82,
      });

      expect(prisma.tbl_address.create).not.toHaveBeenCalled();
      expect(res).toEqual(expect.objectContaining({ id: 50 }));
    });
  });
});
