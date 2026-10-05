// Admin cancel x payment state. With "apply cancellation fee" the old code only
// wrote a wallet-history DEBIT row: the customer's balance never moved, the fee
// never reached pkg_order.cancel_charge, and the order kept order_status 1-3 (so
// a late driver action could still touch it). customerCancel had the same bug and
// was fixed - this is the admin twin.
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { update: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  order_status_history: { create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../../services/dispatchManager", () => ({ stopDispatch: jest.fn() }));
jest.mock("../../services/pricingEngine", () => ({ getPackageById: jest.fn() }));
jest.mock("../../services/pushNotifier", () => ({}));
jest.mock("../../sockets/adminSocket", () => ({ notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn(() => ({ to: () => ({ emit: jest.fn() }) })) }));
jest.mock("../../services/walletPrepaymentRefund", () => ({ refundIfWalletPaid: jest.fn().mockResolvedValue(null), isWalletPaidOrder: jest.fn() }));
jest.mock("../../services/referralPointsRefund", () => ({ refundReferralPointsForOrder: jest.fn().mockResolvedValue(0) }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const walletPrepayment = require("../../services/walletPrepaymentRefund");
const { refundReferralPointsForOrder } = require("../../services/referralPointsRefund");
const { cancel } = require("../adminOrderController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const req = (body = {}) => ({ params: { id: "468" }, body, user: { id: 1, role: "superadmin" } });
const order = (o = {}) => ({ id: 468, uid: 31, rid: 38, city_id: 1, order_status: 2, o_status: "Pickup", delivery_type: 6, p_method_id: 1, trans_id: "cash_1", ...o });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
  prisma.pkg_order.update.mockResolvedValue({});
  prisma.tbl_user.update.mockResolvedValue({});
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  pricingEngine.getPackageById.mockResolvedValue({ cancellation_charge_customer: "50" });
  walletPrepayment.refundIfWalletPaid.mockResolvedValue(null);
});

const walletDebits = () => prisma.tbl_user.update.mock.calls.filter(([a]) => a?.data?.wallet?.decrement).map(([a]) => a.data.wallet.decrement);
const cancelStamp = () => prisma.pkg_order.update.mock.calls.map(([a]) => a.data).find((d) => d.o_status === "Cancelled");

describe("adminOrderController.cancel - payment effects", () => {
  it("assigned order + cancellation fee (cash): the fee actually leaves the customer's wallet and is stored on the order", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    await cancel(req({ apply_cancellation_fee: true, comment: "customer unreachable" }), res());

    expect(walletDebits()).toEqual([50]);
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 31, amount: 50, type: "debit", wallet_type: "user", order_id: 468 }),
    });
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({ where: { id: 468 }, data: { cancel_charge: 50 } });
  });

  it("marks order_status 4 so a late driver action cannot revive the cancelled order", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    await cancel(req(), res());
    expect(cancelStamp()).toMatchObject({ o_status: "Cancelled", order_status: 4 });
  });

  it("assigned order + fee on a WALLET-PAID booking: refund is net of the fee, no second debit", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ p_method_id: -2, trans_id: "wallet_9" }));
    walletPrepayment.refundIfWalletPaid.mockResolvedValue({ refunded: 297, paid: 347 });
    await cancel(req({ apply_cancellation_fee: true }), res());

    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deduct: 50 }));
    expect(walletDebits()).toEqual([]);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({ where: { id: 468 }, data: { cancel_charge: 50 } });
  });

  it("no cancellation fee configured on the package: nothing is charged", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    pricingEngine.getPackageById.mockResolvedValue({ cancellation_charge_customer: "0" });
    await cancel(req({ apply_cancellation_fee: true }), res());
    expect(walletDebits()).toEqual([]);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("assigned order cancelled WITHOUT the fee flag: refunded in full, customer charged nothing", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ p_method_id: -2, trans_id: "wallet_9" }));
    await cancel(req(), res());
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ deduct: expect.anything() }));
    expect(walletDebits()).toEqual([]);
  });

  it("unassigned order: full refund, the fee flag is ignored (nobody was dispatched)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 0, order_status: 0, o_status: "Pending" }));
    await cancel(req({ apply_cancellation_fee: true }), res());
    expect(walletDebits()).toEqual([]);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("referral points are handed back exactly once on every admin cancel path", async () => {
    for (const body of [{}, { apply_cancellation_fee: true }]) {
      jest.clearAllMocks();
      prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
      pricingEngine.getPackageById.mockResolvedValue({ cancellation_charge_customer: "50" });
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      await cancel(req(body), res());
      expect(refundReferralPointsForOrder).toHaveBeenCalledTimes(1);
      expect(refundReferralPointsForOrder).toHaveBeenCalledWith(468);
    }
  });

  it("a paid advance is never debited by an admin cancel (it stays in the customer's wallet)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ payment_status: 1, advance_payment: "60" }));
    await cancel(req({ apply_cancellation_fee: true }), res());
    expect(walletDebits()).toEqual([50]); // the fee only - not the 60 advance
  });

  it("an already completed or cancelled order is rejected without touching any money", async () => {
    for (const o_status of ["Completed", "Cancelled"]) {
      jest.clearAllMocks();
      prisma.pkg_order.findUnique.mockResolvedValue(order({ o_status }));
      const r = res();
      await cancel(req({ apply_cancellation_fee: true }), r);
      expect(r.status).toHaveBeenCalledWith(409);
      expect(prisma.tbl_user.update).not.toHaveBeenCalled();
      expect(refundReferralPointsForOrder).not.toHaveBeenCalled();
    }
  });
});
