jest.mock("../../config/db", () => ({
  tbl_rider: { update: jest.fn() },
  tbl_user_device: { findFirst: jest.fn() },
}));
jest.mock("../../sockets/adminSocket", () => ({
  notifyDriverStatusUpdate: jest.fn(),
  notifyLiveDriverPing: jest.fn(),
}));
jest.mock("../../services/dutyTrackingService", () => ({
  recordDutyLocationPing: jest.fn().mockResolvedValue(undefined),
}));

const prisma = require("../../config/db");
const { setStatus, updateLocation } = require("../riderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("riderController.setStatus location reset", () => {
  beforeEach(() => jest.clearAllMocks());

  it("blanks rlats/rlongs/rloc_updated_at when a driver goes offline", async () => {
    prisma.tbl_rider.update.mockResolvedValue({ id: 5, city_id: 1, a_status: 0, status: 1 });
    const req = { body: { rider_id: 5, a_status: 0 } };

    await setStatus(req, makeRes());

    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { a_status: 0, rlats: null, rlongs: null, rloc_updated_at: null },
      select: { id: true, city_id: true, a_status: true, status: true },
    });
  });

  it("leaves location untouched when a driver goes online", async () => {
    prisma.tbl_rider.update.mockResolvedValue({ id: 5, city_id: 1, a_status: 1, status: 1 });
    const req = { body: { rider_id: 5, a_status: 1 } };

    await setStatus(req, makeRes());

    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { a_status: 1 },
      select: { id: true, city_id: true, a_status: true, status: true },
    });
  });
});

describe("riderController.updateLocation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stamps rloc_updated_at alongside the new coordinates", async () => {
    prisma.tbl_rider.update.mockResolvedValue({ id: 5, city_id: 1 });
    const req = { body: { rider_id: 5, lat: 28.6, lng: 77.2 } };

    await updateLocation(req, makeRes());

    const data = prisma.tbl_rider.update.mock.calls[0][0].data;
    expect(data.rlats).toBe("28.6");
    expect(data.rlongs).toBe("77.2");
    expect(data.rloc_updated_at).toBeInstanceOf(Date);
  });
});
