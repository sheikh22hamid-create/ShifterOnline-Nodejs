jest.mock("../../config/db", () => ({ tbl_user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() } }));
jest.mock("../../utils/cloudinaryStorage", () => ({ uploadBuffer: jest.fn() }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const prisma = require("../../config/db");
const { updateProfile } = require("../customerProfileController");

function mockRes() {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe("updateProfile", () => {
  it("saves name/email/mobile instead of failing with a server error", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 5, password: "pw" });
    prisma.tbl_user.findFirst.mockResolvedValue(null);
    prisma.tbl_user.update.mockResolvedValue({ id: 5, name: "Asha", wallet: 0 });
    const res = mockRes();

    await updateProfile({ body: { uid: 5, fname: "Asha", email: "a@x.com", mobile: "9876543210" } }, res);

    expect(res.json.mock.calls[0][0].ResponseMsg).toBe("Profile Update successfully!");
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ name: "Asha", email: "a@x.com", mobile: 9876543210 }),
    });
  });

  it("works when the app sends no mobile", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 5, password: "pw" });
    prisma.tbl_user.update.mockResolvedValue({ id: 5, wallet: 0 });
    const res = mockRes();
    await updateProfile({ body: { uid: 5, fname: "Asha", email: "a@x.com" } }, res);
    expect(res.json.mock.calls[0][0].Result).toBe("true");
  });
});
