# Shifter system audit — 16 September 2026

Review of the current local working tree: Flutter customer app, Java driver app, Node/Prisma backend, and React admin API integration. This is a focused source audit of critical paths, not an exhaustive certification of every endpoint or a live penetration test. No live database, payment, SMS, or production mutation was performed. Application source was not changed.

Existing edits in `ShifterOnline/lib/screens/home/select_vehicle.dart` and `backend/src/services/pricingEngine.js` were preserved. No AGENTS.md was found in the workspace scan.

## Verification

- Backend Jest: **233 passed, 2 failed, 14 suites total (13 passed)**. Command: `node node_modules/jest/bin/jest.js --runInBand --silent` from backend.
- React admin production build: **passed** (`npm run build`). The initial sandbox attempt could not read parent directories; the approved retry succeeded. Existing warnings include malformed generated CSS and unresolved font-file URLs; browser rendering was not verified.
- Five offline probes reproduced issues using real source functions and in-memory dependencies: `node docs/audit-2026-09-16-repro.cjs`. The payout probe models concurrent stale reads; it is not a real MySQL concurrency test. Payment verification is stubbed successful for the customer replay probe to model a legitimately captured payment being replayed.
- No emulator/device end-to-end run or Flutter/Android build was performed.
- Findings below distinguish executable reproductions from source-confirmed control-flow gaps. Existing passing tests do not cover all these business invariants.

## Findings, in priority order

### 1. Critical — customer/driver identity is supplied by the caller

Evidence: `backend/src/app.js:64`, `backend/src/routes/user.routes.js`, `backend/src/routes/riderRoutes.js`, `backend/src/controllers/customerAuthController.js:300`, `backend/src/sockets/socketServer.js:55`, `backend/src/sockets/orderSocket.js:87`.

Mobile routers are mounted without user-session authentication. For example, delete-account trusts body.uid, withdrawal trusts mobile, and socket joins trust rider_id/user_id/order_id. Socket trip mutations take rider_id directly from the event; comparing that value to the order's rider is not proof of caller identity. Static app-key checks on some endpoints do not establish an individual user's identity. The Flutter Node wrapper sends only Content-Type (`ShifterOnline/lib/Api/Api_wrapper.dart:312`).

Impact: account changes, order mutations, and tracking subscriptions can be attempted as another user/driver by supplying their identifiers. Authenticate REST and sockets, derive identity from a verified session, and enforce resource ownership. This gap exists even though the public simulator is documented as an intentional product decision.

### 2. Critical — negative withdrawal creates wallet balance

Evidence: `backend/src/controllers/customerWalletController.js:199`, especially 206–223; driver request validation also at `backend/src/controllers/driverPayoutController.js:128`.

Only truthiness is checked. A negative amount passes validation and the balance comparison; subtracting it increases the balance. Offline reproduction: wallet 100, withdrawal -50, resulting wallet **150**, with a success response. Driver withdrawal requests likewise accept negative amounts; approval decrements a negative value.

Require finite, strictly positive amounts, valid wallet types, and integer minor units before any financial mutation.

### 3. Critical — paid driver plans activate without verified payment

Evidence: `backend/src/services/driverPlanService.js:271`, `backend/src/controllers/driverPlanController.js:17`.

The purchase flow accepts a payment-method string as sufficient evidence; amount_paid=0 skips its underpayment check. There is no gateway verification. Offline probe activates a 499 plan with only paymentMethod=razorpay and records 499 as paid. Any configured wallet bonus is then credited as well.

Require a server-created payment order, verified captured amount, and a single-use payment reference bound to the driver and plan. The Java purchase payload must be updated with the corresponding order/signature proof too.

### 4. High — customer plan payment replay repeats subscriptions and bonuses

Evidence: `backend/src/services/customerPlanService.js:294`, `backend/prisma/schema.prisma:960`.

Payment verification checks that a payment is valid, but purchase does not consume it uniquely. payment_txn_id is not unique in the subscription schema and there is no replay lookup. Repeating the same valid payment creates another subscription and wallet bonus. Offline probe: one verified payment, two subscriptions, bonus 20 credited twice. Wallet top-up's separate unique razorpay_payment_id does not protect plan purchases from cross-purpose reuse.

Use a shared payment ledger with unique provider payment IDs and purpose/account binding, committed in the same transaction as fulfillment.

### 5. High — password reset trusts global OTP state rather than caller proof

Evidence: `backend/src/controllers/customerAuthController.js:276`.

Forgot-password checks whether that mobile's latest OTP row was verified in the preceding ten minutes. The caller submits neither an OTP nor a reset token, and the verified state is not consumed. After a legitimate verification, another caller knowing the number can reset the password during this window. Offline reproduction confirms the handler accepts mobile and replacement password alone against a recently verified row.

Issue a short-lived, single-use reset token tied to the verified challenge and require it for the password change.

### 6. High — advance-payment verification does not check the ride's required advance

Evidence: `backend/src/controllers/orderController.js:1160`, especially 1176 and 1221.

The gateway amount is compared to body.amount, not to the server's required advance_payment. A real small payment can therefore mark a larger advance as fully paid. Completion subsequently uses the stored required advance for settlement, causing inconsistent customer/driver balances. The handler also reads unpaid state before non-conditional writes, so different payments racing for the same order are not prevented by payment-ID uniqueness.

Bind a payment intent to the order and server-calculated amount, and atomically move that order from unpaid to paid.

### 7. High — trip progression lacks server-enforced state and OTP gates

Evidence: `backend/src/services/tripLifecycle.js:333`, `backend/src/controllers/orderController.js:611`.

updateStatus checks only order existence and matching rider_id. It does not require the expected previous status, successful pickup OTP, or advance-payment completion. verifyPickupOtp only returns a response; it stores no verified trip state. Thus callers can complete a trip without the normal sequence or send arrived on a terminal order. A direct pickup without an existing timer can update the order and then fail updating the timer, leaving a partially changed trip.

Implement conditional state transitions with OTP/payment prerequisites inside the server transaction.

### 8. High — completion is not safely repeatable

Evidence: `backend/src/services/tripLifecycle.js:390`, 510 and 586; `backend/prisma/schema.prisma:1023`.

Calling complete again adds waiting charges to the already increased total_dcharge. Commission/advance ledger guards use findFirst followed by a balance update and ledger insert; payment_id is explicitly non-unique. Two concurrent completions can both pass the guard and debit twice. Plan ride benefits/counters are also invoked again. Terminal status is written before settlement finishes, so a later failure leaves Completed with unfinished accounting.

Atomically claim completion, persist immutable settlement inputs, and enforce unique order/effect ledger keys in the same transaction as balances.

### 9. High — concurrent payout approval can debit twice

Evidence: `backend/src/controllers/payoutController.js:59`, especially 68–92.

Both pending-status and wallet checks happen before the transaction. Two calls can read the same pending withdrawal and sufficient balance, then both unconditionally update it and decrement the wallet. A transaction around writes alone does not protect these earlier checks. Concurrent stale-read probe: one 60 withdrawal, starting balance 100, two approvals, ending balance -20. Actual MySQL concurrency remains to be tested.

Use a row lock or conditional pending-to-approved update, and a conditional balance decrement in one transaction. Also serialize/reserve pending requests in driverPayoutController.withdrawRequest; its current aggregate-then-create can over-reserve concurrently.

### 10. High — wallet top-up can be permanently recorded without credit

Evidence: `backend/src/controllers/customerWalletController.js:118`, `backend/src/controllers/orderController.js:1201`.

The unique payment history row is inserted before the wallet increment, outside a transaction. If the increment fails or the process stops, retry is rejected as already processed although balance was not credited. Advance payments have the same split plus a separate order-paid update. Withdrawal also uses a stale read followed by an absolute balance assignment, so simultaneous withdrawals/recharges can lose updates.

Commit payment consumption, balance mutation, and order payment state atomically; return the prior successful result on idempotent retries.

### 11. High — client-supplied trip distance controls pricing

Evidence: `backend/src/controllers/orderController.js:186`, 266; `backend/src/services/tripLifecycle.js:190`.

For a trip without extra stops, a positive request distance bypasses server route calculation. Creation also accepts positive client total/base charges. Acceptance recomputes the fare, but it uses the already stored client distance, so that does not resolve distance manipulation. This can underprice a long trip and disagree with the actual route.

Use server-computed routing or a server-signed quote tied to coordinates, stops, vehicle, and expiry. Treat client fare/distance as display hints only.

### 12. High — customer cancellation writes a charge without debiting the wallet

Evidence: `backend/src/services/tripLifecycle.js:696`, especially 731–765.

The cancellation-charge branch creates a customer debit-history row but never decrements tbl_user.wallet. It may credit the driver compensation, producing a history/balance mismatch. The raw cancellation update changes o_status but leaves numeric order_status unchanged; active-room recovery uses numeric order_status, so a cancelled trip can still look active to numeric-state readers. Free-cancellation window data is loaded by pricingEngine but not enforced here.

Perform cancellation status, charge/refund, compensation, and subscription usage accounting in one transaction with a single consistent terminal state.

### 13. High — monthly-driver admin operations escape city scoping

Evidence: `backend/src/controllers/monthlyDriverController.js:282`, 333 and 426; monthly-driver routes in `backend/src/routes/adminRoutes.js`.

Attendance receives scopeFilter but never uses req.scopedCityId. Ledger reads and adjustments neither apply the middleware nor check the target rider's city themselves. A city admin can read another city's salary/ledger and submit an adjustment for another city's driver ID; executives can access the unscoped read routes.

Apply target-rider city authorization to each read/write, including attendance and queue endpoints, rather than relying on the React UI's available selections.

### 14. High — Aadhaar name mismatch is accepted

Evidence: `backend/src/utils/aadharPdfVerify.js:204`; failing existing test at `backend/src/utils/__tests__/aadharPdfVerify.test.js:107`.

The match succeeds when any name word appears in the PDF. Existing test supplies a Rahul Verma document for Rahul Sharma; it incorrectly returns verified. This is an actual failing identity-validation test. A second existing test fails because corrupt PDF input is mislabeled as name mismatch rather than unreadable PDF.

Require the intended full-name comparison against the document's identity field, and distinguish corrupt-document errors from identity mismatches. This audit did not evaluate document-signature authenticity.

### 15. Medium — Java plan payment truncates paise before reporting the paid amount

Evidence: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/PlanDetailActivity.java:335`; `backend/src/services/driverPlanService.js:271`.

Checkout pays payableAmount in paise, but the success handler sends `(int) payableAmount`. For a 499.50 payable amount, a successful payment is reported as 499 and the backend rejects it as underpaid. Applies when plan pricing or points produce a fractional rupee payable amount.

Preserve integer paise end-to-end and derive the settled amount from the verified payment, rather than truncating the client decimal.

## Architecture correction and remaining coverage

The current Flutter source still calls the PHP host for package and buy-order history: `ShifterOnline/lib/controllers/p_d_order_histroy_api_controller.dart:29` and `buyany_order_history_api_controller.dart:29`. The package controller is used by `screens/myorder/myorder.dart`. Node has history routes, but those call sites do not use them. This proves a remaining PHP-host dependency; it does not establish whether the deployed PHP URL proxies Node. No live proxy configuration was verified.

Review concentrated on authentication, payment/wallet, plans, trip acceptance/progression/completion/cancellation, driver payouts, monthly-driver admin scope, KYC, and mobile/admin contracts. Full dispatch recovery, every marketing/CMS endpoint, every legacy Buy Anything branch, geofence edge cases, referral fulfillment, and device lifecycle behavior still need dedicated coverage. The critical findings already justify fixing these flows before treating the system as release-ready.

Suggested order: caller identity and payment verification; negative amounts and payment replay; transactional settlement/state machine; cancellation and city scope; KYC; Java precision and remaining PHP routing.
