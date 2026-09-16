// Offline audit probes: real source functions, in-memory dependencies only.
// These assertions confirm current bugs, not desired regression behavior.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const logger = { info() {}, error() {}, warn() {} };
function load(file, dependencies) {
  const module = { exports: {} };
  const context = { module, exports: module.exports, Buffer, Date, console,
    require(id) {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id.endsWith('/logger')) return logger;
      throw new Error(`Unexpected dependency: ${id}`);
    } };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return module.exports;
}
function response() { return { status() { return this; }, json(body) { this.body = body; return this; } }; }
async function main() {
  let wallet = 100;
  const walletDb = {
    tbl_user: { findFirst: async () => ({ id: 1, wallet }), update: async ({ data }) => { wallet = data.wallet; return { wallet }; } },
    tbl_wallet_history: { create: async () => ({}) },
  };
  const walletController = load('backend/src/controllers/customerWalletController.js', {
    '../config/db': walletDb, '../utils/razorpayVerify': {},
  });
  const withdrawal = response();
  await walletController.withdrawWallet({ body: { mobile: '9990000000', amount: -50, wallet_type: 'user' } }, withdrawal);
  assert.equal(wallet, 150);
  console.log('CONFIRMED: negative withdrawal raises wallet 100 -> 150');

  const plan = { id: 1, plan_type: 'DRIVER_PREMIUM', price: 499, validity_days: 30 };
  const driverDb = {
    tbl_rider: { findUnique: async () => ({ id: 1 }) },
    tbl_premium_plan: { findFirst: async () => plan },
    tbl_user_plan_subscription: { findFirst: async () => null, create: async ({ data }) => ({ id: 1, ...data }) },
  };
  driverDb.$transaction = async cb => cb(driverDb);
  const driverPlans = load('backend/src/services/driverPlanService.js', { '../config/db': driverDb });
  const purchase = await driverPlans.purchaseDriverPlan({ driverId: 1, planId: 1, paymentMethod: 'razorpay', amountPaid: 0 });
  assert.equal(purchase.subscription.amount_paid, 499);
  assert.equal(purchase.subscription.status, 'active');
  console.log('CONFIRMED: driver plan activated and recorded as 499 paid without payment ID or verification');

  let bonuses = 0, subscriptions = 0;
  const customerDb = {
    tbl_user: { findUnique: async () => ({ id: 1 }), update: async ({ data }) => { bonuses += data.wallet.increment; } },
    tbl_premium_plan: { findFirst: async () => ({ id: 1, price: 100, validity_days: 30, wallet_bonus_enabled: true, wallet_bonus_amount: 20 }) },
    tbl_user_plan_subscription: { create: async ({ data }) => ({ id: ++subscriptions, ...data }), update: async () => ({}) },
    tbl_wallet_history: { create: async () => ({}) },
  };
  customerDb.$transaction = async cb => cb(customerDb);
  const customerPlans = load('backend/src/services/customerPlanService.js', {
    '../config/db': customerDb, '../utils/razorpayVerify': { verifyRazorpayPayment: async () => ({ ok: true }) },
  });
  const payment = { userId: 1, planId: 1, paymentTxnId: 'same_verified_payment', razorpayOrderId: 'same_order', razorpaySignature: 'same_signature' };
  await customerPlans.purchaseCustomerPlan(payment);
  await customerPlans.purchaseCustomerPlan(payment);
  assert.equal(subscriptions, 2); assert.equal(bonuses, 40);
  console.log('CONFIRMED: replay of one verified customer payment creates 2 subscriptions and 2 bonuses');

  let changedPassword;
  const auth = load('backend/src/controllers/customerAuthController.js', {
    '../config/db': { tbl_otp: { findFirst: async () => ({ status: 1, created_at: new Date() }) },
      tbl_user: { updateMany: async ({ data }) => { changedPassword = data.password; return { count: 1 }; } } },
    '../services/otpService': { normalizeMobile: value => value }, '../services/deviceSessionService': {},
  });
  await auth.forgotPassword({ body: { mobile: '9990000000', password: 'replacement' } }, response());
  assert.equal(changedPassword, 'replacement');
  console.log('CONFIRMED: recently verified mobile can reset password with no caller-bound OTP proof');

  let balance = 100, mutations = 0;
  const payoutDb = {
    driver_withdraw_requests: { findUnique: async () => ({ id: 1, rider_id: 1, status: 'pending', amount: 60 }), update: async () => { mutations++; } },
    tbl_rider: { findUnique: async () => ({ id: 1, wallet_balance: 100 }), update: async ({ data }) => { balance -= data.wallet_balance.decrement; } },
    tbl_wallet_history: { create: async () => ({}) }, tbl_rnoti: { create: async () => ({}) },
    $transaction: async operations => Promise.all(operations),
  };
  const payouts = load('backend/src/controllers/payoutController.js', { '../config/db': payoutDb, '../sockets/adminSocket': { notifyPayoutUpdate() {} } });
  const request = { params: { id: '1' }, body: {}, user: { role: 'superadmin' } };
  await Promise.all([payouts.approve(request, response()), payouts.approve(request, response())]);
  assert.equal(mutations, 2); assert.equal(balance, -20);
  console.log('CONFIRMED with concurrent stale-read model: same payout approved twice, wallet 100 -> -20');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
