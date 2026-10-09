# Test Cases – Bug Fixes & New Features (7 Oct 2026)

Simple checklist for the tester. **Result** column mein Pass / Fail likho. Fail ho to screenshot ya screen recording saath bhejo.

## Pehle ye ready rakho

- Naye APK install karo: **Driver app 1.0.25** aur **Customer app 1.0.20**.
- Backend deploy ho chuka ho. Pickup ETA wala SQL (`backend/sql/20261002_pickup_eta.sql`) production DB par chala ho.
- 1 test customer, 1 test driver (online), 1 admin login. Razorpay **test mode**.
- Note kar lo: admin ka *Advance payment timeout* (default 2 min).

---

## A. Advance payment timeout ke baad payment (Customer app)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| A1 | Booking karo. Driver accept kare. Advance payment ka Razorpay kholo, **timeout se zyada wait** karo, phir payment complete karo. | Paisa gaayab nahi hota. Wallet mein amount **+** hota hai. Wallet history mein credit entry dikhti hai ("…after order cancelled"). Message mein likha ho ki amount wallet mein add hua. Order cancelled hi rehta hai. | |
| A2 | Timeout ke **andar** advance pay karo. | Normal chalta hai. Order cancel nahi hota. | |
| A3 | Wahi payment dobara bhejne ki koshish karo (retry). | Wallet mein sirf **ek baar** paisa aata hai. | |

## B. Wallet se advance apne aap kat jana (Customer app)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| B1 | Wallet ₹150, advance ₹100. Booking karo, driver accept kare. | Advance screen **nahi** aati. Apne aap paid ho jata hai, toast aata hai, agla step khulta hai. Wallet ₹50 ho jata hai. | |
| B2 | B1 ke baad Wallet history dekho. | Debit entry: "Advance payment for order #… (paid from wallet)". | |
| B3 | B1 ke baad Driver app dekho. | Driver ko "Advance Payment Received" notification aata hai. Order mein payment done dikhta hai. | |
| B4 | Wallet ₹60, advance ₹100. | Auto-deduct **nahi**. Normal advance screen aati hai. Wallet ₹60 hi rehta hai. | |
| B5 | Wallet = advance (jaise dono ₹100). | Auto-paid ho jata hai. | |
| B6 | B1 jaisa order, advance paid hone ke baad order **cancel** karo (customer se ya driver se). | Advance wapas wallet mein aata hai. History mein credit "Advance payment refunded". | |
| B7 | B1 jaisa order poora complete karo. | Advance dobara minus **nahi** hota (sirf ek debit). Agar fare advance se kam tha, extra wapas wallet mein aata hai. | |
| B8 | Receiver-pays wala order banao (neeche C section). | Auto-deduct **nahi** hota. Normal advance screen aati hai. | |

## C. "Receiver full payment karega?" (Customer app)

Example: Total ₹100, Advance ₹20.

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| C1 | Checkbox **ON**. Sender ₹20 advance de. | Sender wallet **+₹20**. Receiver ko poora **₹100** dikhta hai (₹80 nahi). | |
| C2 | C1 ki ride complete karo. Receiver ₹100 pay kare. | Sender ke wallet se ₹20 **minus nahi** hota. ₹20 wallet mein bacha rehta hai. | |
| C3 | Us ₹20 ko nayi booking mein use karo. | Wallet balance use ho jata hai. | |
| C4 | Checkbox **OFF**. Sender ₹20 advance de. | Sender wallet +₹20 (abhi ke liye). Receiver ko **₹80** dikhta hai. | |
| C5 | C4 ki ride complete karo. | Wallet se ₹20 **minus** hota hai. Receiver/sender ₹80 pay kare. | |
| C6 | Checkbox ON, par receiver payment **mana kare** (decline). | Wallet se ₹20 minus hota hai aur fare mein adjust hota hai. Koi gadbad nahi. | |
| C7 | Checkbox ON, par admin se payment "Waive" / "Customer owes" karao. | Wallet se ₹20 minus hota hai. Wallet negative nahi hota. | |

## D. Driver app: Accept dabate hi app khulna

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| D1 | Driver **online** rahe. Driver koi doosri app (jaise WhatsApp) mein ho. Order bhejo. Popup aaye. **Accept** dabao. | Button "ACCEPTING…" ho jata hai. Phir **Shifter Driver app apne aap khul jaati hai** aur order screen dikhti hai. | |
| D2 | D1 ko phone **lock** karke karo. | Popup aaye. Accept ke baad app khule. | |
| D3 | Popup aane par order kisi aur driver se accept karwa do, phir Accept dabao. | Popup band ho. Message: order available nahi. App zabardasti nahi khulti. | |
| D4 | Popup mein **Reject** dabao. | Popup band. App nahi khulti. | |
| D5 | Accept dabaye bina popup ka timer khatam hone do. | Popup band ho jata hai. Koi crash nahi. | |

Agar D1 fail ho: phone ka model aur Android version likh do.

## E. Driver login ke baad app band hona

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| E1 | Driver app mein logout karo, phir login karo (mobile + OTP). | Home khulta hai aur **khula rehta hai**. Apne aap band nahi hota. | |
| E2 | Fresh install par login karo. Notification, location aur "Display over other apps" permission allow karo. | App band nahi hoti. Home dikhta hai. | |
| E3 | App ko recents se hata kar dobara kholo. | Home hi khulta hai (login yaad rehta hai). | |

## F. Scheduled booking time settings

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| F1 | Admin → Settings → **Scheduled Rides**. | Naya field "Minimum advance booking time (minutes)" dikhta hai, default **45**. | |
| F2 | Isko **20** karke save karo. User app mein Schedule Booking kholo. 10 min baad ka time chuno. | Error: "Please pick a time at least **20** minutes from now." | |
| F3 | Usi mein 25 min baad ka time chuno. | Allow ho jata hai. Booking ban jati hai. | |
| F4 | Admin value **45** par wapas karo. 30 min baad ka time chuno. | Error mein **45** likha aata hai. | |
| F5 | Admin value **90** karo. 60 min baad ka time chuno. | Error mein **90** likha aata hai. | |
| F6 | Admin → "Confirmation popup lead time" dekho (default 30). Driver app → **Scheduled Trips** kholo. | Heading: "**30**-Minute Priority Dispatch Window". | |
| F7 | Admin mein lead time **20** karo. Driver app Scheduled Trips refresh karo. | Heading "**20**-Minute Priority Dispatch Window". | |

Note: asli priority window server par 2 minute ki hai. Ye heading sirf admin ka lead time dikhati hai.

## G. Admin: Plan Purchase History

Admin → Marketing → **Premium Plans** → **Purchase History** tab.

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| G1 | Customer app se ek plan kharido (Razorpay). | History mein nayi row aati hai: date, customer ka naam/mobile, plan, amount, payment method, transaction id, validity dates, status **Active**. | |
| G2 | Driver app se ek plan kharido. | Row aati hai, "Driver" badge ke saath. | |
| G3 | Plan **referral points** se kharido. | Row mein amount ke saath points aur points ki value dikhti hai. | |
| G4 | Plan jisme wallet bonus hai kharido. | Row mein "bonus credited" dikhta hai. | |
| G5 | Filter: Customers / Drivers. | Sirf wahi rows aati hain. | |
| G6 | Filter: Status (Active / Expired / Cancelled / Pending). | Sahi rows aati hain. | |
| G7 | Date range (From / To) lagao. | Sirf us range ki rows aati hain. | |
| G8 | Search: naam, poora mobile number, transaction id. | Sahi row milti hai. | |
| G9 | Upar ka count aur "collected" amount dekho. | Rows ke total se match karta hai. | |
| G10 | Page 2 / Next dabao (25 se zyada rows ho to). | Pagination chalti hai. | |
| G11 | Kisi **city admin** se login karo. | Sirf apni city ke customers/drivers ki rows dikhti hain. | |

## H. Pickup ETA aur free cancel

Tip: test jaldi karne ke liye admin mein ETA buffer chhota rakho (Settings → pickup ETA buffer).

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| H1 | Booking karo, driver accept kare. Customer app dekho. | "Arriving at pickup in **X min**" aur "**N km away · by hh:mm**" dikhta hai. X = Google ETA + 10 (jaise Google 20 → 30). | |
| H2 | Admin ka buffer badal do (jaise 5). Nayi booking accept karwao. | X = Google ETA + 5. | |
| H3 | Driver deadline se pehle pickup ke radius (200 m) mein pahunch jaye. | "Running late" **nahi** dikhta. | |
| H4 | Driver deadline tak pickup se door rahe. Customer app kholi rakho, kuch mat dabao. | Deadline ke thodi der baad apne aap "Driver is running late. You can cancel for free." dikhta hai. | |
| H5 | H4 ke baad **Cancel** dabao. | Dialog mein "cancel for free" likha ho. Cancel ho jata hai. Koi cancellation charge nahi lagta. | |
| H6 | H5 ke baad customer ka wallet history dekho. | Cancellation charge ki entry **nahi** hai. Plan ki free cancellation count kam nahi hui. | |
| H7 | H5 ke baad driver ka wallet history aur penalty dekho. | Driver ko koi payment/compensation **nahi**. Koi penalty **nahi**. | |
| H8 | Deadline **se pehle** cancel karo. | Normal cancellation rules lagte hain (charge lag sakta hai). | |
| H9 | Driver deadline ke baad pickup par pahunch jaye (arrive kare). | Ab "late" wali state hat jati hai. Free cancel ka option nahi. | |
| H10 | Scheduled booking karo jo apne time par driver accept kare. | ETA dikhta hai (jaise H1). | |

## I. Jaldi regression check (sab kuch pehle jaisa chale)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| I1 | Normal booking → driver accept → advance Razorpay se pay → ride complete. | Sab normal. Wallet history sahi. | |
| I2 | Wallet recharge (Razorpay). | Wallet mein paisa aata hai. | |
| I3 | Customer cancel (driver accept ke baad, ETA se pehle). | Normal cancel flow. | |
| I4 | Driver cancel. | Customer ko notification. Koi crash nahi. | |
| I5 | Admin Settings page save karo. | Naya field bhi save hota hai. Baaki settings waisi hi rehti hain. | |
