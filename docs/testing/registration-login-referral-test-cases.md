# Registration, Login & Referral – Test Cases

Scope: Customer app + Driver app registration/login, and the referral system (code sign-up, sign-up bonus, first-ride reward, redeem points on ride / plan, admin controls).
Written from the actual backend behaviour (`customerAuthController`, `riderAuthController`, `referralRewardService`, `orderController`, `referralPointRules`).

**Legend** – Priority: P0 = must pass before release, P1 = important, P2 = nice to have. Type: UI = app screen, API = Postman / backend, DB = verify in database.

## 0. Test setup

| Item | Detail |
|---|---|
| Customer A | existing customer, has referral code (App → Refer & Earn). Note code as `CODE_A`. |
| Driver D1 | approved driver, has referral code `CODE_D1`. |
| Fresh numbers | keep 6+ unused 10-digit numbers starting 6–9 (customers) and 4+ (drivers). |
| Test OTP mode | Only if `ENABLE_OTP_TEST_MODE=true` (dev only): driver numbers starting `99999` / `88888` accept OTP `123456`. **Must be OFF on prod** (TC-D-OTP-09). |
| Admin | Admin panel → Referrals page: enable/disable, points per referral, sign-up bonus, point value, ride discount %, plan-purchase %. |
| DB checks | `tbl_user`, `tbl_rider`, `tbl_referral`, `tbl_referral_point_log`, `tbl_otp`, `tbl_user_device` / `tbl_rider_device`. |

Defaults to confirm before starting: note the current admin values (points per referral, sign-up bonus, point value, ride discount %).

---

## 1. Customer registration

| ID | Pri | Type | Scenario | Steps | Expected |
|---|---|---|---|---|---|
| TC-C-REG-01 | P0 | UI | New customer, no referral code | Enter new valid mobile → Send OTP → enter correct OTP → fill name (email optional) → Sign up | Account created, lands on Home (no logout loop), wallet 0, own referral code generated (format: 3 letters of name + 5 chars, no `O/0/I/1`). |
| TC-C-REG-02 | P0 | DB | Fields stored correctly | After REG-01 check `tbl_user` | `status=1`, `wallet=0`, `reffer_code` = `referral_code`, `refer_by` null, `rdate` set, `device_id`/`fcm_token` saved, row in `tbl_user_device` active. |
| TC-C-REG-03 | P0 | UI/API | Already registered mobile | Enter a mobile that has an account | "Already Exist Mobile Number!" on mobile-check; register returns "Mobile Number Already Used!". |
| TC-C-REG-04 | P1 | API | Invalid mobile formats | `12345`, `5876543210` (starts with 5), 9 digits, 11 digits, letters | "Please enter a valid 10-digit mobile number!" |
| TC-C-REG-05 | P1 | API | `+91` / `91` / spaces in mobile on register | `+91 98765 43210` | Normalised to last 10 digits, account stored as `9876543210`. |
| TC-C-REG-06 | P1 | UI | Name empty | Leave name blank | "Please fill in all required fields!" |
| TC-C-REG-07 | P1 | API | Email validation | `abc`, `a@b`, valid email, empty | Invalid → "Please enter a valid email address!"; valid or empty → OK. |
| TC-C-REG-08 | P1 | API | Duplicate email | Register with an email already used by another customer | "Email Already Used!" |
| TC-C-REG-09 | P1 | API | Double-tap / retry within 2 min from same device | Send same register twice quickly | Second call returns the same account (success), **no duplicate row**, no second sign-up bonus. |
| TC-C-REG-10 | P1 | API | Same number registered >2 min ago, or from another device | Repeat register | "Mobile Number Already Used!" |
| TC-C-REG-11 | P2 | UI | Name with special chars / emoji / only digits | Register | Account created; refer code prefix falls back to `XXX` + random when name has no A–Z. |
| TC-C-REG-12 | P2 | UI | App killed after OTP verify, before sign-up | Reopen, resume | Can restart flow; no partial account row exists. |
| TC-C-REG-13 | P2 | UI | Deactivated (deleted) account re-registering | Delete account, then register same number | Behaviour is documented: number is still "taken" (soft delete, `status=0`) → "Mobile Number Already Used!". Confirm with product if this is wanted. |

## 2. Customer OTP

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-C-OTP-01 | P0 | UI | Correct OTP | "OTP Verified Successfully!!", proceeds. |
| TC-C-OTP-02 | P0 | UI | Wrong OTP | "Invalid OTP." – stays on screen, can retry. |
| TC-C-OTP-03 | P1 | UI | Resend OTP | Old OTP stops working, new one works (only latest session kept). |
| TC-C-OTP-04 | P1 | UI | OTP for number A used on number B | Rejected. |
| TC-C-OTP-05 | P1 | API | Verify without ever sending OTP | "OTP Session Not Found." |
| TC-C-OTP-06 | P1 | UI | Expired OTP (wait past SMS provider expiry) | "Invalid OTP." and Resend works. |
| TC-C-OTP-07 | P1 | UI | No SMS network / provider down | Clear error message, no crash. |
| TC-C-OTP-08 | P0 | API | Test-bypass is OFF for customers | Customer `send-otp` / `verify-otp` with `123456` on a `99999…` number must **not** bypass (customer flow uses `allowTestBypass:false`). |
| TC-C-OTP-09 | P2 | UI | Rapid repeated "Send OTP" taps | No crash; no duplicate SMS flood beyond provider limits (note count). |

## 3. Customer login / forgot password / logout

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-C-LOG-01 | P0 | UI | OTP login, existing active account | Send OTP → verify → logged in, home shows wallet + addresses. |
| TC-C-LOG-02 | P0 | UI | Password login, correct credentials | "Login successfully!"; `device_id`/`fcm_token` updated. |
| TC-C-LOG-03 | P0 | UI | Wrong password / wrong mobile | "Invalid Email/Mobile No or Password!!!" |
| TC-C-LOG-04 | P0 | UI | Login with a number that has no account (OTP login) | "No account found. Please create an account first!" |
| TC-C-LOG-05 | P0 | UI | Deleted / deactivated account (`status=0`) tries to login | Login refused, no session. |
| TC-C-LOG-06 | P1 | UI | Login on a second phone | Second device becomes active; first device is logged out on next `/home` ("Logged in from another device"). |
| TC-C-LOG-07 | P1 | UI | Fresh sign-up then immediately Home | No "Session expired" bounce (device row registered at sign-up). |
| TC-C-LOG-08 | P1 | UI | Forgot password flow | Mobile → OTP verified → new password → "Password Changed Successfully!!!!!" → login with new password works, old fails. |
| TC-C-LOG-09 | P0 | API | Forgot password **without** OTP verification | Rejected: "Please verify OTP for this mobile number before resetting the password." |
| TC-C-LOG-10 | P1 | API | Forgot password >10 min after OTP verification | Rejected as above. |
| TC-C-LOG-11 | P1 | UI | Language persists after login | Selected app language retained. |
| TC-C-LOG-12 | P1 | UI | Delete account | "Account Delete Successfully!!", user logged out, cannot login again (see LOG-05). |
| TC-C-LOG-13 | P0 | API | `/user/login-by-otp` needs a verified OTP | Call it with only `{mobile}` for an existing account without verifying OTP first → "Please verify OTP for this mobile number first." After a successful `/verify-otp` (within 10 min) the same call logs in. |
| TC-C-LOG-14 | P0 | API | `/user/register` needs a verified OTP | Register without verifying OTP → same message, **no account created**. With verified OTP → success. |

## 4. Driver registration

Driver flow: Mobile → OTP → (new user) registration form with vehicle, KYC docs, profile photo, bank/UPI → verification payment (if admin set a charge) → approval.

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-D-REG-01 | P0 | UI | Full new driver registration, no referral | OTP verify returns `Is_New_User=1`; after form submit: driver row created, `status=1`, `verification_status=pending`, own refer code generated, profile photo saved. |
| TC-D-REG-02 | P0 | UI | Required fields missing | Response "Missing Parameters" listing `mobile, vehicle, vehicle_no, device_id, city_id` as applicable. |
| TC-D-REG-03 | P0 | UI | No profile photo / wrong type (pdf, gif) / >5 MB | "Invalid driver profile photo. Use JPG, PNG or WEBP up to 5 MB." |
| TC-D-REG-04 | P0 | UI | Mobile already registered (full_name set) | "Mobile Number Already Used!" |
| TC-D-REG-05 | P0 | UI | Abandoned registration then return | After OTP verify but form not submitted, re-login resumes at the form (draft row without `full_name`) and submit completes the **same** driver row (no duplicate). Also appears as an incomplete-registration lead for admin follow-up. |
| TC-D-REG-06 | P0 | UI | Duplicate document number (Aadhaar / PAN / RC / DL) used by another existing driver | "<Doc> Number (…) is already registered with another driver account!" |
| TC-D-REG-07 | P1 | UI | Document number left by a deleted driver (orphan) | Allowed – not treated as duplicate. |
| TC-D-REG-08 | P0 | UI | All 4 docs verified + no verification charge | Instantly approved: "Registration successful and Driver profile approved!", `payment_complete=1`. |
| TC-D-REG-09 | P0 | UI | Docs verified + admin verification charge > 0 | Message "Documents verified! Complete the ₹X verification payment…", not approved until paid; app routes to payment screen. |
| TC-D-REG-10 | P1 | UI | Docs not all verified | "Your account is under verification." Admin can approve manually. |
| TC-D-REG-11 | P1 | UI | Charge lowered to ₹0 by admin after registration | Next OTP login marks `payment_complete=1` and approves; driver not stuck on the form. |
| TC-D-REG-12 | P1 | UI | Optional uploads: UPI image, PUC, Bima | Saved when provided, registration works without them. |
| TC-D-REG-13 | P1 | UI | RC owner ≠ driver | `rc_owner_name` / `rc_owner_aadhar_number` stored. |
| TC-D-REG-14 | P1 | UI | Brand-new driver's first Home call | No forced logout (device row registered during registration). |
| TC-D-REG-15 | P1 | UI | Vehicle types (bike vs truck) | Bike/scooter/2-wheeler: no `allowed_body_types`; 4-wheeler: gets body types from category. |
| TC-D-REG-16 | P2 | UI | Network drop during photo upload | Clear error; retry works, no duplicate driver. |
| TC-D-REG-17 | P2 | UI | Malformed `documents` JSON | Registration still works with flat `aadhar_no` etc. fields (ignored parse error). |

## 5. Driver OTP & login

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-D-OTP-01 | P0 | UI | Correct OTP, existing driver | `Is_New_User=0`, "Login Successfully.", DriverData (wallet, plan, verification status, refer code). |
| TC-D-OTP-02 | P0 | UI | Correct OTP, new number | `Is_New_User=1`, "OTP Verified. Continue Registration." |
| TC-D-OTP-03 | P0 | UI | Wrong OTP | "Invalid OTP." |
| TC-D-OTP-04 | P1 | API | Invalid mobile | "Invalid Mobile Number." |
| TC-D-OTP-05 | P1 | UI | Resend OTP | Only newest OTP valid. |
| TC-D-OTP-06 | P1 | UI | Existing driver without a refer code (older accounts) | Refer code auto-generated at login and shown. |
| TC-D-OTP-07 | P0 | UI | Blocked driver (`status=0`) | Cannot use app; blocked message with reason where applicable (password login shows "Your account has been blocked: <reason>"). Verify OTP login also stops a blocked driver reaching Home. |
| TC-D-OTP-08 | P1 | UI | Driver logs in on second phone | First phone logged out on next `/home`. |
| TC-D-OTP-09 | P0 | API | Test OTP bypass off in prod | On production, `99999xxxxx` + `123456` must **fail**. |
| TC-D-OTP-10 | P1 | UI | Logout | `fcm_token` cleared, no push after logout; re-login works. |
| TC-D-OTP-11 | P1 | UI | Language selection (all 9 Indian languages) | Persists after login/restart. |
| TC-D-OTP-12 | P1 | API | Password login (legacy) correct / wrong / blocked | OK / "Invalid Email/Mobile No or Password!!!" / blocked message. |

---

## 6. Referral – sign-up with a code

Settings assumed: referral enabled, sign-up bonus = 50 points (change as you like), points-per-referral = 100.

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-R-REG-01 | P0 | UI | New customer signs up with **customer** code `CODE_A` | Account created. `tbl_referral`: referrer=A (USER), referred=new (USER), `status=pending`, `points_awarded=0`. `tbl_user.referred_by=A`, `referred_by_type=USER`. |
| TC-R-REG-02 | P0 | DB | Sign-up bonus to the referred customer | New user `referral_points` += bonus; log row `source=signup_bonus`, `balance_after` correct. Referrer gets **nothing yet**. |
| TC-R-REG-03 | P0 | UI | New customer signs up with **driver** code `CODE_D1` | Referral row (referrer_type=DRIVER). New customer is auto-added to D1's **Favorite drivers**. |
| TC-R-REG-04 | P0 | UI | Invalid / unknown code | "Invalid Referral Code!" – account **not** created. |
| TC-R-REG-05 | P1 | UI | Code in lower-case / with spaces | Treated case-insensitively and trimmed. |
| TC-R-REG-06 | P1 | UI | Empty code | Normal signup, no referral row, no bonus. |
| TC-R-REG-07 | P0 | UI | New driver signs up with a **driver** code | `tbl_referral` DRIVER→DRIVER pending; `referred_by`, `referred_by_type=DRIVER` on `tbl_rider`; sign-up bonus to new driver. |
| TC-R-REG-08 | P0 | UI | New driver signs up with a **customer** code | Referral row referrer_type=USER, referred_type=DRIVER. |
| TC-R-REG-09 | P1 | UI | Driver registers again (resubmit after draft) with code | Only **one** `tbl_referral` row for that driver (no duplicate bonus). |
| TC-R-REG-10 | P1 | API | Sign-up bonus = 0 or program disabled | No bonus row/points; referral row behaviour as per admin (check when disabled: bonus 0, registration still succeeds). |
| TC-R-REG-11 | P0 | UI | User tries own code | Not possible at signup (code is generated after); confirm Apply-referral for an already-registered user cannot self-refer. |
| TC-R-REG-12 | P1 | UI | Referral code also entered via deep link / Share message | Code pre-filled and accepted. |
| TC-R-REG-13 | P1 | UI | Same person registers a second account with same code on same device | Allowed technically; **flag for fraud review** – check device_id duplicates in admin. |

## 7. Referral – first-ride reward (referrer's points)

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-R-RWD-01 | P0 | UI+DB | Referred **customer** completes 1st ride | Referrer gets `user_points_per_referral` (customer) points; referral row `completed`, `points_awarded`, `verified_at`, `ride_id=order id`; log row `referral_reward`. |
| TC-R-RWD-02 | P0 | UI+DB | Referred **driver** completes 1st ride | Referrer gets `driver_points_per_referral`. |
| TC-R-RWD-03 | P0 | DB | Second / third ride of the same referred person | **No additional** reward (status already `completed`). |
| TC-R-RWD-04 | P0 | DB | Referred person only **books/cancels**, ride not completed | No reward, referral stays `pending`. |
| TC-R-RWD-05 | P1 | DB | Ride completes while program disabled | No reward; verify what happens after re-enabling (row stays `pending`; next completed ride rewards). |
| TC-R-RWD-06 | P1 | DB | Points value set to 0 / negative | No reward, no crash. |
| TC-R-RWD-07 | P0 | DB | Two rides completing at the same instant (concurrency) | Reward credited **once** (atomic pending→completed claim). |
| TC-R-RWD-08 | P1 | DB | Admin changes points-per-referral between signup and 1st ride | Reward uses the **current** admin value at completion. |
| TC-R-RWD-09 | P1 | UI | Driver app: refresh / "claim referral reward" / sync | Pending rewards for completed referred orders get credited once; repeat calls don't double credit. |
| TC-R-RWD-10 | P1 | DB | Self-healing: driver has `referred_by` but no `tbl_referral` row | Row is created and rewarded on first completed ride. |
| TC-R-RWD-11 | P2 | UI | Referrer deleted/blocked before reward | No crash; reward skipped or credited per policy (note actual). |

## 8. Referral – lead flow (phone contact referrals)

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-R-LEAD-01 | P1 | UI | Driver / customer submits a friend's number as lead; admin verifies; friend signs up with **no code** (customer) | `tbl_referral` row `source=lead`, lead → `converted`, sign-up bonus to friend, referrer gets `lead_referral_points` on 1st ride. Driver-referrer: friend auto-added to Favorite drivers. |
| TC-R-LEAD-02 | P1 | UI | Lead expired (past verification window, default 45 days) | No referral link created. |
| TC-R-LEAD-03 | P1 | UI | Lead not verified by admin | Ignored. |
| TC-R-LEAD-04 | P1 | UI | Driver lead → friend registers as **driver** with no code | Referral created, lead converted. |
| TC-R-LEAD-05 | P1 | UI | Friend signs up with **both** a manual code and a matching lead | Manual code wins: exactly **one** `tbl_referral` row, sign-up bonus credited once, lead stays `verified` (not converted). |

## 9. Using referral points

### 9a. Ride discount (customer)

Admin: referral enabled, `ride_discount_percent` e.g. 20, `point_value` e.g. ₹1.

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-R-USE-01 | P0 | UI | Customer with points toggles "Use referral points" on a ₹200 ride | Discount = min(points, 20% of fare ÷ point value); shown on Confirm Booking; points deducted at booking; log row `ride_discount` (debit). |
| TC-R-USE-02 | P0 | UI | Points less than the cap | Uses all points, rest paid normally. |
| TC-R-USE-03 | P0 | UI | Discount % = 0 or program disabled | Option hidden / no discount applied. |
| TC-R-USE-04 | P0 | UI | Coupon + points together | Points cap computed on fare **after** coupon; total discount never exceeds fare. |
| TC-R-USE-05 | P0 | DB | Race: two bookings at once with same balance | Never negative balance; second booking simply skips points. |
| TC-R-USE-06 | P0 | UI+DB | Order that used points is cancelled (customer, driver, admin, no driver found, OTP no-show, advance timeout) | Points returned once (log row `ride_discount_refund`, `referral_points_used` reset to 0); repeat cancel doesn't refund twice. |
| TC-R-USE-07 | P1 | UI | Pay remaining amount with points on payment screen (paying by points instead of Razorpay) | Capped by admin %; "Not enough referral points available." when short; balance decremented once. |
| TC-R-USE-08 | P1 | UI | Wallet-paid or cash orders using points | Cash due at completion reduced by the points amount; driver earning/commission unaffected (platform absorbs). |
| TC-R-USE-09 | P1 | UI | Point value ≠ 1 (e.g. ₹0.5) | Amount = points × value, rounded to 2 decimals. |

### 9b. Plan purchase

Admin: `plan_purchase_enabled`, `plan_points_max_percent`.

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-R-PLAN-01 | P0 | UI | Customer buys premium plan with points, cap 100% | Points can cover the full price (last point rounds up); no Razorpay needed when payable = 0. |
| TC-R-PLAN-02 | P0 | UI | Cap 50% | Points cover ≤ 50%; remainder via payment; displayed amount = points × value. |
| TC-R-PLAN-03 | P0 | UI | Driver buys plan using points | Same rules; log row in `tbl_referral_point_log` (user_type DRIVER). |
| TC-R-PLAN-04 | P0 | UI | Plan purchase toggle OFF | Points option hidden / rejected. |
| TC-R-PLAN-05 | P1 | UI | Not enough points | Uses what's available; remainder paid. |
| TC-R-PLAN-06 | P1 | DB | Payment fails after points reserved | Points restored (check balance and log). |
| TC-R-PLAN-07 | P1 | UI | Per-plan "referral_enabled" off | Plan still purchasable with points (flag now only controls *earning*). |
| TC-R-PLAN-08 | P1 | UI | Driver due clearing using points | Dues reduced, balance and log correct. |

## 10. Admin panel – Referrals

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-R-ADM-01 | P0 | UI | Open Referrals page | Current settings, list of referrals with referrer/referred, status, points. |
| TC-R-ADM-02 | P0 | UI | Edit each setting (points per referral user/driver/lead, sign-up bonus, point value, ride discount %, plan %, share message, enable switch) | Saved, applied to the **next** event; invalid values (negative, >100 %) rejected or clamped. |
| TC-R-ADM-03 | P1 | UI | Search a user/driver and adjust points (add / deduct) | Balance and point log updated with note; deduct can't go below 0. |
| TC-R-ADM-04 | P1 | UI | Point log filters | Filter by user, type, date works; credits/debits consistent with balances. |
| TC-R-ADM-05 | P1 | UI | Share message edit | New text appears in Refer & Earn share in both apps. |
| TC-R-ADM-06 | P2 | UI | Non-admin / logged-out access to referral admin APIs | 401/403. |

## 11. Apps – Refer & Earn screens

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-R-APP-01 | P0 | UI | Customer: Refer & Earn screen | Own code, share via WhatsApp, points balance, referral list statuses (pending/completed). |
| TC-R-APP-02 | P0 | UI | Driver: Refer & Earn / Referral screen | Same for driver, including `check-referral`, `apply-referral`. |
| TC-R-APP-03 | P1 | UI | Apply a referral code **after** signup (driver `apply-referral`) | Accepted once; rejected for own code, unknown code, or when a referrer already exists. |
| TC-R-APP-04 | P1 | UI | Language switch | All referral labels translated; no raw keys. |
| TC-R-APP-05 | P1 | UI | Points balance after reward/redeem | Updates without app restart (pull to refresh). |

## 12. Cross-cutting / negative

| ID | Pri | Type | Scenario | Expected |
|---|---|---|---|---|
| TC-X-01 | P0 | API | SQL-injection style strings in mobile / name / referral code | Rejected or stored harmlessly, no 500. |
| TC-X-02 | P1 | API | Very long name (200+ chars) / email | Handled with an error or truncation, no 500. |
| TC-X-03 | P1 | UI | Slow / offline network at each step | Friendly error, button re-enabled, no duplicate account. |
| TC-X-04 | P1 | UI | Phone clock wrong | Login/registration unaffected. |
| TC-X-05 | P1 | UI | Rotate screen / background app during OTP | State preserved. |
| TC-X-06 | P1 | UI | Fresh install + update from older build | Existing session survives; no forced re-login. |
| TC-X-07 | P2 | UI | Two accounts (customer + driver) on same phone number | Both work independently (separate tables). |
| TC-X-08 | P0 | DB | After the whole suite | No orphan `tbl_referral` rows, no negative `referral_points`, `sum(log.points)` per user = `referral_points`. |

---

## Observations from reading the code – status

1. `/user/login-by-otp` and `/user/register` did not verify the OTP server-side → **fixed** (TC-C-LOG-13/14). Driver `register` is still not gated (a long KYC form can outlast a 10-minute window) – decide separately.
2. Customer lead + manual code could double-credit the sign-up bonus → **fixed** (TC-R-LEAD-05).
3. Referral points not restored on some cancels (no driver found, OTP no-show, admin, advance timeout) → **fixed**; customer/driver cancel already restored them (TC-R-USE-06).
4. Test OTP bypass depends on `ENABLE_OTP_TEST_MODE` – confirm it is unset on prod (TC-D-OTP-09 / TC-C-OTP-08).
5. 2Factor API key hard-coded fallback → **removed**; `TWOFACTOR_API_KEY` must be set in the environment (OTP send/verify fails without it).
6. Passwords are stored in plaintext (known, deliberate decision noted in code).
