# Customer app Home jank — investigation (Plan 1, Task 3)

Date: 2026-11-16. Static scan only: no Android device/emulator was connected (`flutter devices` showed
Chrome/Edge only), so the DevTools profile run moves to Plan 1 Task 8's manual checklist.

## Causes, ranked by likely frame cost

1. **Home is destroyed and rebuilt on every tab switch.** `lib/bottombar.dart:260` renders
   `body: _pageOption[_selectedIndex]`, so leaving Home disposes it and coming back re-runs
   `Home.initState` (`lib/screens/home/home.dart:2797`): GPS read, reverse geocoding (`fetchAddress`),
   saved-locations API, an SQLite insert, and `FirebaseAccesstoken().getAccessToken()` (cause 2).
   Same for Orders / Wallet / Account.
   *Fix:* `IndexedStack` keeps tabs alive — **out of scope, owner decision**: tabs would no longer
   reload their data each time they are opened (e.g. Orders list would not refresh on revisit).

2. **RSA signing on the UI thread on every Home open.** `home.dart:2811-2812` calls
   `FirebaseAccesstoken().getAccessToken()` (`lib/screens/home/chatscreen.dart:352`), which builds a
   service-account JWT with `googleapis_auth` (`clientViaServiceAccount`). The RSA signature runs in
   Dart on the main isolate — tens to hundreds of ms on low-end phones — every time Home is created
   (cause 1 multiplies it).
   *Fix:* fetch once per app session / cache until expiry — **logic change, owner decision.**
   **Security (urgent, separate from this redesign):** that class ships a Firebase service-account
   **private key inside the customer APK**. Anyone who unpacks the APK gets admin credentials for the
   Firebase project. The key should be revoked/rotated in Google Cloud and FCM sends moved to the
   Node backend. Not changed here — owner decision.

3. **One 4,201-line `build()` rebuilds for every `setState`.** `home.dart:3196` listens to
   `ColorNotifier` and every one of ~35 `setState` calls (location, saved places, availability,
   order-status checks) rebuilds the whole Home tree, including network vehicle images.
   *Fix (UI-only, Task 8):* the new section widgets are small, `const` where possible, take plain data;
   header animation sits in its own `RepaintBoundary` so it never repaints the page.

4. **Full-resolution network image decoding.** Vehicle images use `FadeInImage.assetNetwork`
   (`home.dart:3608`, `3687`) with no `cacheWidth`, so large server images decode at full size.
   *Fix (UI-only, Task 6/8):* `cacheWidth: 300` on vehicle images (cards are 136 px wide).

5. **Whole-screen spinner while loading.** `isLoding` swaps the entire page for a
   `CircularProgressIndicator`, so the page pops in at once.
   *Fix (UI-only, Task 8):* `AppSkeleton` placeholders in the final layout.

## Applied in Task 8 (UI-only)

Causes 3, 4, 5. Causes 1 and 2 need the owner's go-ahead (behaviour/logic changes).
