# Single-entry Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign In becomes the only entry screen: phone → OTP → existing user goes Home, new user fills a Profile Details page and is registered without a second OTP.

**Architecture:** `login-by-otp` tells the app apart "no account" (`UserExists: false`) from every other failure. The app then pushes a new `CompleteProfile` screen that calls the existing `singUpApi` (backend accepts it because the verified OTP stays valid 10 min). The old 3-step `SignUp` screen is deleted; its city/referral widgets move to a shared file.

**Tech Stack:** Node/Express + Prisma + Jest (backend), Flutter + GetX (customer app `ShifterOnline/`).

**Spec:** `docs/superpowers/specs/2026-11-17-single-entry-login-design.md`

## Global Constraints

- `ShifterOnline/` is gitignored: stage app files with `git add -f <exact files>`; a deleted file with `git rm --cached` / `git add -f -A <path>` as appropriate.
- Styling: white background, accent `#FA4500` / CTA `#FF6B35`, CTA text `#1A0B04`, fonts `Gilroy_Bold` / `Gilroy_Medium` (match `signin.dart`).
- Existing-user behaviour unchanged: `paymenttype == 'payment' || 'BuyAnything'` → `Get.back()`, else `Get.offAll(Bottombar)`.
- Register payload unchanged (`singUpApi` in `verification.dart`), `ccode: '+91'`, `password: ''`.
- Do not push or deploy.

## Review Focus

- Network down / 500 on `login-by-otp` → toast, user stays on the OTP step (must NOT open Profile Details). Pinned by Task 1 contract + Task 4 code.
- Blocked/deleted account (`status != 1`) → "deactivated" message, never Profile Details. Task 1 test.
- User sits on Profile Details > 10 min → register returns "Please verify OTP…" → toast + back to `SignIn`. Task 3 test.
- Back from Profile Details → returns to Sign In, no account created. Task 3 (PopScope).
- Double-tap Create Account → one request (button disabled while loading). Task 3 test.

---

### Task 1: Backend — `UserExists` flag on login-by-otp

**Files:**
- Modify: `backend/src/controllers/customerAuthController.js:156-169`
- Test: `backend/src/controllers/__tests__/customerAuthController.otpGate.test.js`

**Interfaces:**
- Produces: `POST /api/users/login-by-otp` failure bodies:
  - no row for mobile (any status) → `{ResponseCode:"401", Result:"false", ResponseMsg:"No account found. Please create an account first!", UserExists:false}`
  - row with `status != 1` → `{Result:"false", ResponseMsg:"This account is deactivated. Please contact support.", UserExists:true}`
  - success body unchanged.

- [ ] **Step 1: Write failing tests** in a new `describe("loginByOtp account lookup")`:
  - `it("flags UserExists:false when no account has this mobile")` — `findFirst` → `null`; expect body `toMatchObject({Result:"false", UserExists:false})`.
  - `it("refuses a deactivated account without sending it to sign-up")` — `findFirst` → `{id:7, mobile:9876543210, status:0, wallet:0}`; expect `{Result:"false", UserExists:true, ResponseMsg: expect.stringMatching(/deactivated/i)}` and `UserLogin` undefined.
- [ ] **Step 2:** `cd backend && npx jest customerAuthController.otpGate` → the two new tests FAIL.
- [ ] **Step 3:** Change the lookup to `findFirst({ where: { mobile: Number(mobile) } })` (no status filter), then: no user → respond with `fail` body + `UserExists:false`; `user.status !== 1` → deactivated body + `UserExists:true`. Keep the OTP-verified check after these. Add a local helper `failWith(res, msg, extra)` or inline `res.status(200).json({...})` — same shape as `fail`.
- [ ] **Step 4:** Re-run → all tests in the file PASS.
- [ ] **Step 5: Commit** `feat(auth): login-by-otp reports UserExists so app can route new users`.

### Task 2: Shared profile-form widgets

**Files:**
- Create: `ShifterOnline/lib/screens/authscreen/widgets/profile_form_widgets.dart`
- Modify: `ShifterOnline/lib/screens/authscreen/signup.dart` (import the shared file, drop moved classes — file is deleted in Task 4 but must compile until then)
- Test: `ShifterOnline/test/profile_form_widgets_test.dart`

**Interfaces:**
- Produces (public, moved verbatim from `signup.dart` and renamed):
  - `class AuthTokens` (was `_Tokens`, same constants)
  - `class CityModel {String id; String title;}`
  - `CitySelector({CityModel? selectedCity, String? error, required VoidCallback onTap})`
  - `ReferralAccordion({required bool expanded, required TextEditingController controller, required FocusNode focusNode, required VoidCallback onToggle})`
  - `CitySheet({required List<CityModel> cityList, required bool isLoading, required ValueChanged<CityModel> onSelect})`
  - `ProfileFormErrors validateProfileForm({required String name, required String email, CityModel? city})` where `ProfileFormErrors {String? name; String? email; String? city; bool get ok}`; messages: `'Please enter your full name'`, `'Enter a valid email address'` (regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`, only when non-empty), `'Please select your city'`.

- [ ] **Step 1: Failing tests** `test/profile_form_widgets_test.dart`:
  - `validateProfileForm(name:'  ', email:'', city:null)` → `name` and `city` errors set, `email` null, `ok == false`.
  - `validateProfileForm(name:'Ravi', email:'bad@', city:CityModel(id:'1',title:'Indore'))` → only `email` error.
  - `validateProfileForm(name:'Ravi', email:'', city:CityModel(id:'1',title:'Indore')).ok == true`.
  - widget: `CitySheet` with 2 cities, typing `ind` in the search field leaves only `Indore` visible.
- [ ] **Step 2:** `cd ShifterOnline && flutter test test/profile_form_widgets_test.dart` → FAIL (file missing).
- [ ] **Step 3:** Move the classes, add `validateProfileForm`, update `signup.dart` to use them.
- [ ] **Step 4:** Tests PASS; `flutter analyze lib/screens/authscreen` shows no new errors.
- [ ] **Step 5: Commit** (`git add -f` the 3 files) `refactor(customer-ui): extract profile form widgets for reuse`.

### Task 3: `CompleteProfile` screen

**Files:**
- Create: `ShifterOnline/lib/screens/authscreen/complete_profile.dart`
- Test: `ShifterOnline/test/complete_profile_test.dart`

**Interfaces:**
- Consumes: Task 2 widgets + `validateProfileForm`; `singUpApi(...)` from `verification.dart` (returns `Future<bool>`, navigates to Bottombar itself on success).
- Produces: `CompleteProfile({required String mobile, String? type, Future<List<CityModel>> Function()? loadCities, Future<Map?> Function(Map<String,String> form)? submit})`. `loadCities` defaults to `GET Config.nodeCities` (parse `CityData` like `signup.dart:_fetchCities`); `submit` is a test seam — when null the screen calls `singUpApi`. Register "OTP expired" detection: response/toast message matching `/verify OTP/i` → `tostmsg('Session expired, please verify your number again')` + `Get.offAll(() => SignIn(paymenttype: type))`. Since `singUpApi` only returns bool, add an optional `ValueChanged<String>? onFailMessage` param to `singUpApi` called with the server message on failure.

Layout (top → bottom): back arrow + "Complete your profile" title; subtitle "Signing up with +91 <mobile>"; card with Full Name, Email (Optional), City, Referral accordion; CTA "Create Account" (disabled + spinner while submitting); small text "By creating an account you agree to our Terms and Conditions and Privacy Policy" (links open same URLs as `signin.dart`). `PopScope` back → `Get.back()` to Sign In.

- [ ] **Step 1: Failing widget tests** (pump inside `GetMaterialApp`, `loadCities: () async => [CityModel(id:'1',title:'Indore')]`, `submit` fake):
  - shows `'+91 9876543210'`.
  - tap Create Account with empty form → `'Please enter your full name'` and `'Please select your city'` visible, `submit` not called.
  - fill name, pick Indore, tap CTA twice quickly (fake `submit` awaits a `Completer`) → `submit` called once with `{'name':'Ravi','email':'','city_id':'1','referral':''}`.
- [ ] **Step 2:** `flutter test test/complete_profile_test.dart` → FAIL.
- [ ] **Step 3:** Implement the screen.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5: Commit** (`git add -f` screen, test, `verification.dart`) `feat(customer-ui): profile details screen for new users after OTP`.

### Task 4: Wire Sign In, onboarding; delete SignUp

**Files:**
- Modify: `ShifterOnline/lib/screens/authscreen/signin.dart:336-342` and `:800-831`
- Modify: `ShifterOnline/lib/onboarding.dart:157-159`
- Delete: `ShifterOnline/lib/screens/authscreen/signup.dart`

- [ ] **Step 1:** In `_handleVerifyOtp`, on login failure: if `loginRes?['UserExists'] == false` → `Get.off(() => CompleteProfile(mobile: mobile, type: widget.paymenttype))`; otherwise toast `ResponseMsg` (fallback `'Something went wrong. Please try again.'`) and stay on step 1. Remove the "New to Shifter Online? Create Account" block and its `SizedBox` spacing; remove `import 'signup.dart'`.
- [ ] **Step 2:** `onboarding.dart`: the `i == 1` branch opens `SignIn(paymenttype: "onboarding")` too; replace the signup import.
- [ ] **Step 3:** Delete `signup.dart`; `grep -rn "signup.dart\|SignUp(" lib` → no hits.
- [ ] **Step 4:** `flutter analyze` → no new errors; `flutter test` → all pass.
- [ ] **Step 5: Commit** (`git add -f` the changed files, `git rm --cached` + remove signup.dart) `feat(customer-ui): single entry login - new users go OTP -> profile, no separate sign-up screen`.
