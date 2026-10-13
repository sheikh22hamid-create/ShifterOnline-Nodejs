# Shifter Online – Code Check ke baad Kaam ki Status (12 Oct 2026)

Maine list ke har point ko **code me dekha** (backend, admin panel, customer app, driver app). Neeche 5 hisse hain:

1. **Code me bana mila** (list me pending tha, par code me hai)
2. **Adhura bana hai** (kuch hissa hai, kuch baaki)
3. **Code me bilkul nahi mila** (nayi cheez banani hai)
4. **Sirf live test se pata chalega** (bug / device ka kaam)
5. **Pehle tumse clarification chahiye**

Aur aakhir me wo hissa jo tumne `( done )` likha tha (code me dobara nahi dekha).

**Kaise padhna:** "Bana mila" ka matlab hai ki code me feature maujood hai. Ye phone/server par chala ke nahi dekha, to "working" ki guarantee nahi, sirf "code likha hua hai".

## Gintii (jo pending list me tha)

| Hissa | Items |
|---|---|
| 1. Code me bana mila | 22 |
| 2. Adhura bana hai | 9 |
| 3. Code me bilkul nahi mila | 8 |
| 4. Sirf live test se pata chalega | 6 |
| 5. Clarification chahiye | 8 |
| Abhi nahi karna (security) | 1 |

---

# 1. CODE ME BANA MILA (list me pending tha)

Sab me "test + deploy" baaki hai. Ye sab items tester ko dene layak hain.

| # | Point | Code me kahan | Dhyan dene wali baat |
|---|---|---|---|
| 1 | Daily Driver ko pehle request, radius/busy/online check, nahi to normal drivers | `orderStageService.js` (Daily stage = punched-in daily drivers), `dispatchManager.js` | Ye tiered dispatch ke piche hai aur `tiered_dispatch_enabled` **default OFF** hai. ON karne par hi chalega. |
| 2 | Monthly driver 10 baje se pehle duty start ke liye admin permission | `duty_early_start_request` table, `dutyTrackingService.js`, admin route `/monthly-drivers/early-start-requests/:id/decision`, `MonthlyDutyStatus.java` | Pura flow device par test karo. |
| 3 | Admin popup ke "View Order" par details | `AppShell.jsx` (`setActiveOrderDrawerId` → order drawer khulta hai) | – |
| 4 | Driver min withdrawal (baaki amount ledger me hi rahe) | `customerWalletController.js` ~562-601 (`maxWithdrawable = balance − reserve − pending`), message "₹X must stay in your ledger" | Tumhara example (min 10, ledger 20, withdraw 20) error dega. |
| 5 | Driver withdraw par saved UPI/bank use, ya naya daalo | `customerWalletController.js` ~603 | Admin approve karta hai (seedha payout nahi, E-1 jaisa). |
| 6 | Customer app me privacy policy default unchecked | `signup.dart` `_termsAccepted = false` | – |
| 7 | OTP verify ke baad waiting/loading timer (backend) | `driverTripService.js` (`otp_verified_at`, `pickup_load_wait_start`), `tripLifecycle.js` | Driver app ka "Loading complete" button alag check karo (hissa 2, item 5). |
| 8 | User cancel kare to driver ko cancel popup + alert (kisi bhi screen par) | Driver app: `OrderCancelAlert.java`, `OrderOverlayService.java`, `MyFirebaseMessagingService.java` | Google Maps/doosri app ke upar real phone par test zaroori. |
| 9 | Wallet add par "Platform convenience fees (2.5%)" | `wallet_page.dart` + 9 bhasha ka translation | – |
| 10 | Wallet add par max amount limit admin se | `getCustomerWalletMaxTopup` (`driverWalletSettings.js`) | – |
| 11 | User driver ko block kare, max limit admin se | `blockedDriverController.js` (`max_blocked_drivers_per_user`) | – |
| 12 | Live location par vehicle image (red icon nahi) | `trackingway.dart` `loadVehicleMarker(categoryName)` | Device par dekho. |
| 13 | Orders me "Favorite" tab, favorite toggle, "Book Again" | `myorder.dart` (tab "Favorite", `toggleFavoriteOrder`, `_bookAgainFromOrder`) | "Book Again" ka "No Driver Available" bug fix hua ya nahi, ye live check karo. |
| 14 | Trip Feedback: DB + driver dialog (1–5 star, labels "1 Star = Low Rating"/"5 Stars = Best Rating", No entry zone, Customer type, Goods type) + admin page | `order_driver_feedback` table, `driverFeedbackController.js`, `DriverTripFeedbackDialog.java`, admin `/trip-feedback` | Goods type table me save hota hai ya nahi verify karo (table me `goods_type` column nahi dikha). |
| 15 | Early Drop (Complete dabate hi GPS location actual drop, fare recalculate) | `earlyDropService.js` (300 m se zyada door ho to early drop) | – |
| 16 | "Import from WhatsApp" seedha WhatsApp kholna | `location_search_screen.dart` `_openWhatsApp()` | Device par check (Android 11+ package visibility). |
| 17 | Sign-up bonus credit (user + driver) | `creditSignUpBonus` (`customerAuthController`, `riderAuthController`), ledger label "Signup bonus" | Admin setting `signup_bonus_points` **default 0** hai. 0 hone par bonus nahi milega, "kaam nahi kar raha" ka ye bhi karan ho sakta hai. |
| 18 | Add Stop max limit app me enforce | `select_vehicle.dart` (`_vehicleMaxExtraStops`) | – |
| 19 | Booking Guidelines admin se editable + app me | `bookingGuidelineController.js`, admin page `BookingGuidelines.jsx`, `confirm_order_map.dart` `_fetchBookingGuidelines()` | – |
| 20 | Restricted Items admin se + app me | `restrictedItemController`, `/api/order/restricted-items`, `confirm_order_map.dart` `_fetchRestrictedItems()` | – |
| 21 | Plan purchase history admin panel me (premium plans) | `adminPlanPurchaseController.js`, tab "Purchase History" in `PremiumPlans.jsx` | **Driver ke plans** ki history alag hai ya nahi, verify karo. |
| 22 | Receiver ko WhatsApp bot se message / link | `receiverTrackMessage.js`, "Receiver gets a WhatsApp link to pay" | Naya kuch chahiye to D-4 dekho. |

---

# 2. ADHURA BANA HAI (kuch hai, kuch baaki)

**2.1 ETA countdown + cancel messaging (user + driver app)**
- **Bana hai:** backend `pickupEtaService.js` ETA + remaining seconds + expired flag bhejta hai. Customer app (`trackingway.dart`) me remaining seconds ka countdown aur "Your driver did not reach the pickup in time. You can cancel for free" dialog hai.
- **Baaki:** **Driver app me countdown aur wo message bilkul nahi hai** (driver app me `pickup_eta` ka koi use nahi). Driver app message chahiye: "Countdown complete hone se pehle pickup par pahunchkar 'Arrived' click karein…". Customer app me bhi wahi live countdown (11 → 10 → 9) aur message "Countdown complete hone ke baad aap cancel kar sakte hain. Aap par koi cancellation charge nahi lagega." check karo.
- **Rules jo verify karne hain:** (a) countdown se pehle user cancel kare → driver ko charge nahi, penalty nahi; (b) driver countdown se pehle "Arrived" dabaye, phir user cancel kare → driver ko charge.

**2.2 Monthly Driver ke baaki rules**
- **Bana hai:** early start permission (hissa 1, item 2), overtime pay (in-zone minutes ke upar × overtime rate).
- **Baaki:**
  - 7:45 par order accept karne par **delivery + return ka time pehle se calculate** karna, overtime fix karna, aur **duty automatic end** hona. Ye logic code me nahi mila (sirf shift ke baad overtime ginta hai).
  - **Offline jane se pehle End Duty zaroori:** nahi mila. Driver app me offline jane par duty end hone ki rok nahi dikhi.

**2.3 Daily Driver "Start Duty" offline par**
- **Bana hai:** server rokta hai: "Please go online before starting your Daily Driver duty." (`dailyDriverDutyService.js` ~102).
- **Baaki:** button offline me bhi click hota hai (error message aata hai). Tum chahte ho button click hi na ho. App me button disable karna hai (`HomeFragment.java`).

**2.4 Scheduled Booking – poora flow**
- **Bana hai:** 30-min advance hata diya (`SCHEDULED_ORDER_GO_LIVE_LEAD_MS: 0`), confirm popup admin-configurable (`scheduled_confirm_popup_minutes`, "Do you still want to continue…" `bottombar.dart`), driver app "No scheduled order right now", user ko "Your order will go LIVE at the selected time…" (`select_vehicle.dart`), 45-min minimum advance admin se, driver app ka "Priority Dispatch Window" ab dynamic (`ScheduledTripsActivity.java`).
- **Baaki / verify:** (a) pre-accepted drivers ko **4 KM radius** me pehle priority; (b) sab reject kare to user ko **"No drivers found"** message; (c) Pickup Date & Time highlight; (d) date/time chuna na ho to Confirm dabane par date-time page par redirect; (e) driver app ka priority window "Confirmation Popup Lead Time" se aa raha hai (ye `scheduled_confirm_popup_minutes` ka hi doosra naam hai, verify karo). In 5 ko phone par chala ke dekho.

**2.5 Waiting timer (driver app)**
- **Bana hai:** backend me OTP verify hote hi waiting/loading timer (`pickup_load_wait_start`).
- **Baaki / verify:** driver app me **"Loading complete" button**, aur kuch meter door jane par **auto** complete hona. Driver app me "loading complete" ka button nahi mila. Pickup location capture OTP verify ke time par ho raha hai ya nahi, ye bhi verify karo.

**2.6 Driver Referral Points: plan khareedna + outstanding clear**
- **Bana hai:** `driverPlanService.js` / `driverPlanController.js` points se plan purchase ko handle karte hain.
- **Baaki:** **outstanding / negative wallet ko points se clear karne ka option** code me nahi mila. Plan purchase driver app me chalta hai ya nahi, verify karo.

**2.7 Customer app: Orders section – detail box**
- **Bana hai:** Favorite tab, Book Again (hissa 1, item 13).
- **Baaki / verify:** Recently/Completed ke detail box me Vehicle Type, Trip Start/End Time, Driver naam + vehicle number sab dikhte hain ya nahi.

**2.8 Wallet → "Ledger" naam**
- Max limit bana hai (hissa 1, item 10). **Naam badal kar "Ledger"** user app me aur driver app me hua ya nahi, verify karo. Driver "wallet" ko ledger ki tarah chalana (entries, balance) bhi isi se judta hai.

**2.9 Driver app home ke top par vehicle details**
- Home me body type ka card hai (`fragment_home.xml` `card_home_body_type`). **Vehicle Number** home ke top par hai ya nahi, verify karo.

---

# 3. CODE ME BILKUL NAHI MILA (nayi cheez banani hai)

**3.1 Booking Guarantee: compensation sirf admin ke diye time-window me (kitni baje se kitni baje)**
- Kya chahiye: Admin decide kare compensation kitni baje se kitni baje tak milega. Is time ke bahar order fail ho to compensation nahi milega.
- Abhi: sirf "admin arrangement minutes" hai. Din ke time ki window nahi. (`compensation_from/to` jaisa kuch nahi.)
- Kaise karna hai: `city_order_settings` me `compensation_from`, `compensation_to` (HH:MM, IST) jodna. Order jis time fail ho (admin window khatam hone ka time), agar window ke andar nahi to compensation 0 aur order bas cancel. Midnight cross karne wali window bhi chale (22:00 se 06:00). Admin panel me do time fields.
- Test: window ke andar fail → compensation mile; bahar fail → na mile; lock sirf tab lage jab compensation mile.

**3.2 Driver Performance Report (admin panel)**
- Kya chahiye: har driver ke liye total orders received, accepted/rejected/skipped (date-time ke saath), completed, cancelled, applied penalty + reason, acceptance %, completion %, rejection/skip %, overall score/status. Free / Daily / Normal ka alag filter.
- Abhi: event table `driver_order_event` data jama kar rahi hai. Report API/page nahi hai.
- Kaise karna hai: admin API + React page. Jis offer par `superseded` event hai use sab percentages se bahar rakho. Score formula (spec): 0.4 acceptance + 0.4 completion + 0.2 (100 − reject/skip); Excellent ≥ 85, Good ≥ 70, Average ≥ 50. Formula manager se confirm karo.

**3.3 Next Day Booking – Model 1 (2 PM auto-live + Daily Driver ka 10% kam payout)**
- Kya chahiye: next-day order ke baad admin agle din 2:00 PM se pehle Daily Driver arrange kare. Daily driver accept → usi ko; reject/skip → agle Daily driver ko. 2 PM tak admin arrange na kare to order apne aap **Live** ho kar Normal drivers ko jaye. Daily Driver ka next-day payout normal fare se **10% kam** (₹100 → ₹90), farq admin settle kare.
- Abhi: code me 2 PM auto-live nahi mila. 10% wala payout nahi mila. (`orderController.js` me sirf order daalne ka 10 PM cutoff hai, jo alag hai.)
- Pehle sawal: 10% kam sirf driver payout par (customer fare par nahi)? 2:00 PM fixed ya admin configurable?

**3.4 Registration fee vehicle-type wise**
- Kya chahiye: admin panel me har vehicle type (Bike, E-Rickshaw, Three-Wheeler, Four-Wheeler) ki alag registration fee. Driver registration par jo vehicle type chune, wahi fee lage.
- Abhi: code me registration fee ka koi field nahi mila (na DB, na admin, na driver app).

**3.5 Models / vehicle options ke badlaav (admin driver detail)**
- "**All (Open, Half & Covered Available)**" option abhi bhi hai: `frontend/src/components/drivers/DriverDetailDrawer.jsx` lines 526 aur 1101 (`<option value="both">`). Ise hatana hai.
- "Full body open" option ka naam/edit: tumse exact text chahiye.
- Driver profile me **Loading / Unloading** options: nahi mile.

**3.6 Customer app: new register par auto-login**
- Abhi signup ke baad `Get.offAll(SignIn(...))` hota hai, yaani dobara login karna padta hai. Auto-login nahi hai.

**3.7 Admin / Super Admin "Agent system"**
- Database me `agent` ka koi role ya table nahi hai. Pehle spec chahiye (D-3).

**3.8 Test ride me "online/offline aur Model on/off" samjhana**
- Text nahi mila. Isme explanation messages likhne hain (D-7).

---

# 4. SIRF LIVE TEST SE PATA CHALEGA (code padhkar nahi bata sakte)

1. **Pickup 2 baar badalne par Internal Server Error:** reproduce karna hoga (order id, status). Pickup change ka code `orderPickupService.js` me hai.
2. **Pickup badalne par driver ke "Cash to collect" popup me extra amount nahi judta:** do order par check karo.
3. **Favorite driver hata nahi pa rahe:** toggle endpoint `/favorites/toggle` hai. Kaunsi screen se hata rahe ho, kab fail hota hai, ye reproduce karna hoga.
4. **Aadhaar eKYC "verification failed":** UIDAI IP block ho sakta hai. Alag IP/device se dobara test.
5. **Trial driver order flow:** poora flow test.
6. **Battery:** real phone par battery stats se naapna hoga (location interval, wakelock).

Aur 3 purane testing items: user ki ride 10 min ke baad auto-cancel hone par driver ko notification (5 Oct ko pickup ETA wala auto-cancel hata diya gaya tha, to ye kaunsa cancel hai? Pehle confirm karo ki abhi ho raha hai ya nahi); Ledger me transaction ka asli time (tumne "not imp" likha); multi-language ka pura text (aage 5.1 dekho).

---

# 5. CLARIFICATION CHAHIYE

1. **Multi-language:** customer app me 9 bhasha ki file (`language_indian.dart`) hai, driver app me bhi 9 values-folder hain. "Baaki text change nahi ho rahe" ka matlab kuch screens ke strings hard-coded hain. Kaunsi screens me text nahi badal raha, uski list chahiye (ya main saare hard-coded strings ka audit kar du). Kaun si bhasha aur translation kaun dega?
2. **Driver login ke baad app band:** phone model, Android version, har baar ya kabhi kabhi, crash log (logcat).
3. **Driver info save ke baad dikhti nahi:** kaunsa screen (driver app profile ya admin driver detail)? kaunsi fields? ek example driver ID.
4. **Withdraw par seedha Razorpay payout:** abhi driver request bhejta hai aur admin approve karta hai (saved bank/UPI use hota hai). "System seedha Razorpay se transfer kare" ka matlab: admin approve karte hi apne aap Razorpay se transfer? Ya driver khud seedha? (Doosra abhi nahi karna, E-1.)
5. **Favorite route "one change required":** kaunsa change?
6. **"Tones ko 2 karna":** kaun si 2 tones, kahan?
7. **Free Driver: popup ya auto-assign?** List me dono likha hai. Abhi system popup (Accept/Reject) deta hai.
8. **Models page me ₹/km aur min ₹ hide:** kaunsa "Models page"? Customer app me fare breakdown (`select_vehicle.dart` ~1330 "Distance charge × ₹/km") hai. Wahi? Ya vehicle detail "i" button? Exact screen chahiye.

**Aur:** "Service charge pata nahi kahan se add ho raha hai" ka jawab mil gaya: ye `tbl_package.service_charge_percent` se aata hai (admin Rate Card me). Pricing me `subtotal + subtotal × service% + night charge` lagta hai (`orderAvailabilityController.js`, `pricingEngine.js`). Rate Card me jis model ka percent 0 se zyada hai, wahi add ho raha hai. Hatana ho to wahi field 0 kar do, ya batao to app me label dikhaun.

---

# E. ABHI NAHI KARNA
- **Driver ledger se seedha Razorpay payout, bina admin permission ke.** Security ke karan abhi nahi (tumhara faisla).

---

# TUMHARI LIST ME `( done )` WALE ITEMS

Ye maine code me dobara nahi dekhe; tumhare mark ke bharose rakhe hain. Jo is session me bana (System 2, city-wise guarantee, free-order lock/unlock, tiered dispatch) wo bhi upar ke done me gina hai.

Driver app: vehicle type home me, ringtone volume (Google voice/Ringtone), offline last-location fix, refer & earn page, auto arrive/pickup/drop, favorite route, privacy policy unchecked (driver), contact permission, customer care no., bot helpline no., model info admin se, DOB scroll, live face verification, logout par go-offline popup, PUC aur Bima, test ride bina commission, OTP autofill, multi-language (adhura, 5.1), Model 1 cancel-block limit admin se, Model 1/5 charges, partner OTP data admin me, vehicle type default blank, auto-redirect on accept, open/cover body.
Customer app: scheduled minimum advance configurable, scroll-down button, "You are still saving!" text, Sender–Receiver payment (Faizan), driver rating popup, back button, route map in order detail, cancellation charge ledger, add stops drag-drop, plan reward, advance payment UI, advance timeout ledger, wallet auto-deduct for advance, booking discount with referral points.
Admin: dispute solve, revenue/profit, driver/user ledger adjustments, models "i" button, daily driver plan vehicle dropdown, next-day bug fix, next-day driver-assign notification, monthly driver, Add Stop settings, trial driver vehicle dropdown, pickup per km charge test.
Is session: System 2, city-wise guarantee, free-order aur guarantee ka alag lock/unlock, tiered dispatch (Free→Daily→Normal, penalty, cancel approval, refund popup).
