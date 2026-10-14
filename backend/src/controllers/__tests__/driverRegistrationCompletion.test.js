jest.mock("../../config/db", () => ({
  tbl_user_device: { findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_personal_doc: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock("../../utils/cloudinaryStorage", () => ({ uploadBuffer: jest.fn().mockResolvedValue("images/rider_docs/x.jpg") }));
jest.mock("../../utils/driverApproval", () => ({ evaluateDriverApproval: jest.fn().mockResolvedValue({}) }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const mockStatus = jest.fn();
jest.mock("../../services/registrationCompletionService", () => ({ getRegistrationStatus: (...a) => mockStatus(...a) }));

const prisma = require("../../config/db");
const { evaluateDriverApproval } = require("../../utils/driverApproval");
const { complete } = require("../driverRegistrationCompletionController");

const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
// multer's middleware passes straight through when the request is not multipart.
const run = async (body, files) => {
  const r = res();
  await new Promise((resolve) => {
    r.json.mockImplementation(() => { resolve(); return r; });
    complete({ headers: {}, body, files }, r);
  });
  return r;
};
const out = (r) => r.json.mock.calls[0][0];
const REG = { is_trial: false, is_complete: false, flow: "remaining_documents", items: [] };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tbl_user_device.findFirst.mockResolvedValue({ device_id: "dev1" });
  prisma.tbl_rider.findUnique.mockResolvedValue({ id: 5 });
  prisma.tbl_personal_doc.findFirst.mockResolvedValue({ id: 9, rider_id: 5, pan_status: 0, pan_id: "" });
  mockStatus.mockResolvedValue(REG);
});

describe("POST /rider/registration/complete", () => {
  it("rejects a request from a device the driver is not logged in on", async () => {
    const r = await run({ rider_id: "5", device_id: "other", email: "a@b.co" });
    expect(out(r).ResponseCode).toBe("403");
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("sends a trial driver to the full registration instead", async () => {
    mockStatus.mockResolvedValue({ ...REG, is_trial: true });
    const r = await run({ rider_id: "5", device_id: "dev1", email: "a@b.co" });
    expect(out(r).ResponseCode).toBe("409");
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("updates the existing account's email and bank details only", async () => {
    const r = await run({ rider_id: "5", device_id: "dev1", email: "a@b.co", account_number: "123456789", ifsc: "sbin0000466" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { email: "a@b.co", account_number: "123456789", ifsc: "SBIN0000466" } });
    expect(out(r).Result).toBe("true");
  });

  it("stores a PAN as pending admin review unless the app verified it", async () => {
    prisma.tbl_personal_doc.findFirst.mockResolvedValueOnce({ id: 9, pan_status: 0, pan_id: "" }).mockResolvedValueOnce(null);
    await run({ rider_id: "5", device_id: "dev1", pan_number: "abcde1234f" });
    expect(prisma.tbl_personal_doc.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { pan_id: "ABCDE1234F", pan_status: 0 } });
  });

  it("marks the PAN verified when the app's eKYC check passed", async () => {
    prisma.tbl_personal_doc.findFirst.mockResolvedValueOnce({ id: 9, pan_status: 0, pan_id: "" }).mockResolvedValueOnce(null);
    await run({ rider_id: "5", device_id: "dev1", pan_number: "ABCDE1234F", pan_verified: "true" });
    expect(prisma.tbl_personal_doc.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { pan_id: "ABCDE1234F", pan_status: 1 } });
  });

  it("rejects a PAN already used by another driver", async () => {
    prisma.tbl_personal_doc.findFirst.mockResolvedValueOnce({ id: 9, pan_status: 0, pan_id: "" }).mockResolvedValueOnce({ id: 3, rider_id: 8 });
    const r = await run({ rider_id: "5", device_id: "dev1", pan_number: "ABCDE1234F" });
    expect(out(r).ResponseMsg).toMatch(/already registered/);
    expect(prisma.tbl_personal_doc.update).not.toHaveBeenCalled();
  });

  it("does not overwrite an already-approved PAN", async () => {
    prisma.tbl_personal_doc.findFirst.mockResolvedValue({ id: 9, pan_status: 1, pan_id: "ZZZZZ9999Z" });
    const r = await run({ rider_id: "5", device_id: "dev1", pan_number: "ABCDE1234F" });
    expect(prisma.tbl_personal_doc.update).not.toHaveBeenCalled();
    expect(out(r).ResponseMsg).toMatch(/Nothing to update/);
  });

  it("validates formats and asks for something to update", async () => {
    expect(out(await run({ rider_id: "5", device_id: "dev1", pan_number: "bad" })).ResponseMsg).toMatch(/valid PAN/);
    expect(out(await run({ rider_id: "5", device_id: "dev1", ifsc: "SBIN0000466" })).ResponseMsg).toMatch(/account number/);
    expect(out(await run({ rider_id: "5", device_id: "dev1" })).ResponseMsg).toMatch(/Nothing to update/);
  });

  it("saves an uploaded insurance image and re-runs the approval gate", async () => {
    const file = { mimetype: "image/png", originalname: "b.png", buffer: Buffer.from("x") };
    await run({ rider_id: "5", device_id: "dev1" }, { bima_image: [file] });
    expect(prisma.tbl_personal_doc.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { bima_image: "images/rider_docs/x.jpg" } });
    expect(evaluateDriverApproval).toHaveBeenCalledWith(5);
  });
});
