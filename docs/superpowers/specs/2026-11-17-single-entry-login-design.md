# Single-entry login (customer app) — design

Date: 2026-11-17 · Branch: feature/customer-ui-redesign · Size: small change

## Why
The Sign In screen already looks good; the separate Create Account screen does not.
A new user today goes Sign In → OTP → "account not found" → thrown onto the 3-step
SignUp screen, which asks for the mobile number **and OTP again**. Owner wants one
entry screen: phone → OTP → existing user goes Home, new user fills profile details.

## Goals
- Sign In is the only entry point for login and sign-up.
- New user verifies OTP once, then sees a Profile Details page (Name, Email optional,
  City, Referral code) and lands on Home after registering.
- Existing user behaviour unchanged (OTP → Home, or `Get.back()` for payment/BuyAnything).
- Network/server errors no longer get treated as "account not found".

## Non-goals
- No change to OTP sending/verification, register API fields, or referral logic.
- Driver app untouched.

## Approaches
1. **Chosen — branch after OTP on the Sign In screen.** `login-by-otp` returns a
   distinct `UserExists: false` when no account exists; app pushes a new Profile
   Details page with the verified mobile. Register works because the backend keeps
   the verified OTP valid for 10 minutes.
2. Call `mobile-check` before sending OTP and pick login vs signup up front — extra
   round trip, and leaks "is registered" before OTP. Rejected.
3. Restyle the existing SignUp screen only — keeps the double OTP. Rejected.

## Design
**Backend** (`customerAuthController.loginByOtp`)
- No row for the mobile at all → `fail` response plus `UserExists: false`.
- Row exists but `status != 1` (blocked/deleted) → `fail` with "This account is
  deactivated. Please contact support." and `UserExists: true` (so the app does
  not send them to sign-up, where register would say "Mobile Number Already Used").
- Jest tests for both cases.

**App**
- New `lib/screens/authscreen/complete_profile.dart` (`CompleteProfile(mobile, type)`):
  Name, Email (optional), City picker, Referral accordion, Create Account button,
  in the redesign style (white, #FA4500/#FF6B35 accent, Gilroy). Reuses
  `singUpApi` (which saves session and goes to Bottombar). If register answers
  "Please verify OTP…" (10-min window passed) → toast + `Get.offAll(SignIn)`.
  Back button returns to Sign In (no account created). Terms line shown as text
  ("By creating an account you agree…"), no checkbox — Sign In already shows it.
  City-sheet/referral widgets are moved out of `signup.dart` into a shared widget
  file so they can be reused.
- `signin.dart`: on `loginRes['UserExists'] == false` → `Get.off(CompleteProfile)`;
  any other failure → toast only, stay on OTP step. Remove the
  "New to Shifter Online? Create Account" link.
- `onboarding.dart`: the "Sign Up" button opens `SignIn` instead of `SignUp`.
- Delete `signup.dart` once nothing references it.

## Left to the builder
Exact visual layout of Profile Details within the redesign style; whether `ccode`
is sent as "+91" (Sign In already hard-codes +91).
