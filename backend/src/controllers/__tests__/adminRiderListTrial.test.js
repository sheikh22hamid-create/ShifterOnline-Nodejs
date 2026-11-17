jest.mock("../../config/db", () => ({
  tbl_rider: { findMany: jest.fn(), count: jest.fn() },
  tbl_city: { findMany: jest.fn() },
  tbl_rider_delivery_type: { findMany: jest.fn() },
  tbl_package: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));

const prisma = require("../../config/db");
const { list } = require("../adminRiderController");

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

describe("adminRiderController.list trial_status filter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 5, fname: "Ravi", fmobile: "9000000005", a_status: 0, city_id: null, trial_status: "active" }]);
    prisma.tbl_rider.count.mockResolvedValue(1);
    prisma.tbl_city.findMany.mockResolvedValue([]);
    prisma.tbl_rider_delivery_type.findMany.mockResolvedValue([]);
    prisma.tbl_package.findMany.mockResolvedValue([]);
  });

  it("filters by a valid trial_status and returns it on each row", async () => {
    const res = makeRes();
    await list({ query: { status: "1", trial_status: "active" } }, res);
    expect(prisma.tbl_rider.findMany.mock.calls[0][0].where).toEqual({ status: 1, trial_status: "active" });
    expect(res.json.mock.calls[0][0].data[0].trial_status).toBe("active");
  });

  it("ignores an unknown trial_status value", async () => {
    const res = makeRes();
    await list({ query: { trial_status: "bogus" } }, res);
    expect(prisma.tbl_rider.findMany.mock.calls[0][0].where).toEqual({});
  });
});
