// Same mock header as settlementService.test.js, plus the free-booking service.
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { update: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/socketServer", () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
}));
jest.mock("../freeBookingService", () => ({ tryCredit: jest.fn().mockResolvedValue({ credited: false }) }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const freeBookingService = require("../freeBookingService");
const settlementService = require("../settlementService");

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const settlement = (status) => ({ id: 1, order_id: 50, uid: 7, rid: 9, status });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
});

describe("runTransition free-booking hook", () => {
  it.each(["cash_received", "paid_online"])("tries the free-booking credit after a transition to %s", async (status) => {
    await settlementService.runTransition(async () => ({ settlement: settlement(status) }));
    await flush();
    expect(freeBookingService.tryCredit).toHaveBeenCalledWith(50);
  });

  it.each(["pending", "disputed", "waived", "customer_owes"])("does not try the credit for %s", async (status) => {
    await settlementService.runTransition(async () => ({ settlement: settlement(status) }));
    await flush();
    expect(freeBookingService.tryCredit).not.toHaveBeenCalled();
  });

  it("does not retry on an alreadyDone no-op", async () => {
    await settlementService.runTransition(async () => ({ settlement: settlement("paid_online"), alreadyDone: true }));
    await flush();
    expect(freeBookingService.tryCredit).not.toHaveBeenCalled();
  });

  it("a failing credit never breaks the settlement transition", async () => {
    freeBookingService.tryCredit.mockRejectedValueOnce(new Error("boom"));
    const out = await settlementService.runTransition(async () => ({ settlement: settlement("paid_online") }));
    await flush();
    expect(out.settlement.status).toBe("paid_online");
    expect(logger.error).toHaveBeenCalled();
  });
});
