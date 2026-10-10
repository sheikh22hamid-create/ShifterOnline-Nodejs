# Driver App Test Cases – Bug Fixes & New Features (7 Oct 2026)

**App Version:** Driver App 1.0.25  
**Tester Checklist:** Result column mein **Pass / Fail** likho. Agar Fail ho to screenshot ya screen recording attach karo (phone model aur Android version note karo).

---

## Pehle ye ready rakho
- Driver App **v1.0.25** install ho.
- Permissions: Notification, Location ("All the time"), aur "Display over other apps" (Overlay permission) zaroor allowed hon.
- 1 active test driver (online, verified).
- Ek customer phone / account booking bhejne ke liye.

---

## 1. Accept Dabate Hi App Khulna (Section D - Overlay & Background)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| D1 | Driver app mein **Online** raho. Driver koi doosri app (jaise WhatsApp / YouTube) use kar raha ho. Booking bhejo. Incoming order popup screen par aaye. **Accept** dabao. | Button turant "ACCEPTING…" hota hai. Phir **Shifter Driver app apne aap foreground mein khul jaati hai** aur order details screen open hoti hai. | |
| D2 | Phone ko **screen lock** karke rakho (screen off). Booking trigger karo. | Phone wake ho, popup aaye. **Accept** dabate hi phone unlock/screen par Shifter Driver app open ho jaye. | |
| D3 | Popup aane par, kisi doosre driver se wo order accept karwa do (order taken). Phir pehle phone par **Accept** dabao. | Popup band ho jaye. Toast message: "Order is no longer available". App zabardasti nahi khulti. | |
| D4 | Popup aane par **Reject** dabao. | Popup smoothly band ho jata hai. App open nahi hoti. | |
| D5 | Accept ya Reject dabaye bina popup ka 15-second countdown timer khatam hone do. | Popup timer khatam hone par apne aap band ho jata hai. App crash nahi hoti. | |

*Note for D1-D5:* Agar D1 fail ho to device model aur Android version note karo.

---

## 2. Driver Login Stability & Crash Fix (Section E)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| E1 | Driver app se Logout karo, phir wapas Mobile + OTP daalkar login karo. | Home screen khulti hai aur **khuli rehti hai**. Background mein crash ya auto-close nahi hoti. | |
| E2 | Fresh install / Clear Data karo. Login karo, Notification, Location aur "Display over other apps" permissions allow karo. | App turant band nahi hoti. Home screen steady dikhti hai. | |
| E3 | App ko running state mein recents (task switcher) se swipe karke kill karo, phir app icon par tap karke dobara kholo. | Direct Home screen khulti hai (session intact rehta hai, bar bar OTP nahi mangta). | |

---

## 3. Customer Auto-Deduct Notification (Section B)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| B3 | Customer ke wallet se advance apne aap katne par (Customer Task B1), Driver phone dekho. | Driver ko notification aana chahiye: "**Advance Payment Received**". Driver app order screen mein advance payment completed / paid dikhta hai. | |

---

## 4. Scheduled Trips Priority Dispatch Window (Section F)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| F6 | Admin settings mein "Confirmation popup lead time" **30 min** set ho. Driver app → **Scheduled Trips** screen kholo. | Screen par heading dikhti hai: "**30**-Minute Priority Dispatch Window". | |
| F7 | Admin lead time ko **20 min** kare. Driver app mein Scheduled Trips refresh karo. | Heading update ho kar dikhti hai: "**20**-Minute Priority Dispatch Window". | |

---

## 5. Pickup ETA & Arrived Checks (Section H)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| H3 | Driver booking accept karne ke baad deadline se pehle pickup location ke 200m radius mein pahunch jaye. | Customer app par "Running late" **nahi** dikhta. Normal arrival flow chalta hai. | |
| H7 | Driver bohot late ho aur customer ne "Free Cancellation" use karke order cancel kar diya ho. Driver ka **Wallet History** aur penalty check karo. | Driver par koi penalty/fine **nahi** lagti aur koi compensation credit nahi hota. | |
| H9 | Driver deadline exceed hone ke baad pickup par pahunche aur "Arrived" mark kare. | Arrived state mark ho jati hai. Late warning hat jati hai. | |

---

## 6. Plans & Regression Check (Section G & I)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| G2 | Driver app se Premium Plan kharido (Razorpay ya points). | Plan activate ho jata hai, validity update hoti hai, admin history mein "Driver" badge dikhta hai. | |
| I4 | Active order par Driver Cancel kare (reason select karke). | Order successfully cancel hota hai, customer ko cancel notification milta hai, driver app home par aati hai bina kisi crash ke. | |
