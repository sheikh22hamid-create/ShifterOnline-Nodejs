# Customer App Test Cases – Bug Fixes & New Features (7 Oct 2026)

**App Version:** Customer App 1.0.20  
**Tester Checklist:** Result column mein **Pass / Fail** likho. Agar Fail ho to screenshot ya screen recording attach karo.

---

## Pehle ye ready rakho
- Customer App **v1.0.20** install ho.
- 1 test customer account (login via OTP).
- Wallet mein test balance (jaise ₹150+).
- Razorpay test mode active ho.

---

## 1. Advance Payment Timeout ke baad Payment (Section A)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| A1 | Booking karo. Driver accept kare. Advance payment ka Razorpay kholo, **timeout (default 2 min) se zyada wait** karo, phir payment complete karo. | Paisa gaayab nahi hota. Wallet mein amount **+** hota hai. Wallet history mein credit entry dikhti hai ("…after order cancelled"). Screen/toast par message aaye ki amount wallet mein add hua. Order cancelled hi rehta hai. | |
| A2 | Timeout ke **andar** advance pay karo. | Normal payment complete hoti hai. Order cancel nahi hota, next step khulta hai. | |
| A3 | Wahi payment dobara bhejne ki koshish karo (retry). | Wallet mein sirf **ek baar** paisa credit hota hai, double credit nahi hota. | |

---

## 2. Wallet se Advance Apne Aap Kat Jana / Auto-Deduct (Section B)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| B1 | Wallet balance ₹150 ho, advance ₹100 ho. Booking karo, driver accept kare. | Advance payment screen **nahi** aati. Apne aap auto-paid ho jata hai, toast message aata hai, agla tracking step khulta hai. Wallet balance ₹50 ho jata hai. | |
| B2 | B1 ke baad Customer App mein **Wallet History** dekho. | Debit entry dikhti hai: "Advance payment for order #… (paid from wallet)". | |
| B4 | Wallet ₹60 ho, advance ₹100 ho. | Auto-deduct **nahi** hota. Normal Razorpay advance payment screen aati hai. Wallet ₹60 hi rehta hai. | |
| B5 | Wallet balance = advance amount (jaise dono ₹100). | Auto-paid ho jata hai, wallet ₹0 ho jata hai. | |
| B6 | B1 jaisa auto-deduct order banne ke baad order **cancel** karo (customer ya driver se). | Advance amount turant wallet mein refund ho jata hai. History mein credit entry: "Advance payment refunded". | |
| B7 | B1 jaisa auto-deduct order poora complete karo. | Advance dobara minus **nahi** hota (sirf ek baar debit). Agar final fare advance se kam nikla, to bacha hua paisa wallet mein wapas aata hai. | |
| B8 | Receiver-pays wala order banao (neeche point 3). | Auto-deduct **nahi** hota. Normal advance screen aati hai. | |

---

## 3. "Receiver Full Payment Karega?" Checkbox (Section C)
*Example: Total Fare ₹100, Advance ₹20.*

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| C1 | Checkbox **ON** karke booking karo. Sender ₹20 advance de. | Sender ke wallet mein ₹20 **credit (+)** ho jata hai. Receiver ko poora **₹100** dikhta hai (₹80 nahi). | |
| C2 | C1 wali ride complete karo. Receiver ₹100 pay kare. | Sender ke wallet se ₹20 **minus nahi** hota. ₹20 wallet balance mein bacha rehta hai. | |
| C3 | Us bache hue ₹20 ko nayi booking mein use karo. | Wallet balance booking mein properly use ho jata hai. | |
| C4 | Checkbox **OFF** karke booking karo. Sender ₹20 advance de. | Sender wallet +₹20 (temporary). Receiver ko **₹80** dikhta hai. | |
| C5 | C4 wali ride complete karo. | Ride complete hote hi sender wallet se ₹20 **minus** hota hai. | |
| C6 | Checkbox ON ho, par receiver payment karne se **mana kare** (decline). | Wallet se ₹20 minus hota hai aur fare mein adjust ho jata hai. | |
| C7 | Checkbox ON ho, par admin se payment "Waive" / "Customer owes" ho. | Wallet se ₹20 minus hota hai, par wallet negative nahi hota. | |

---

## 4. Scheduled Booking Time Settings (Section F)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| F2 | Admin ne minimum advance time **20 min** set kiya ho. User app mein Schedule Booking kholo aur 10 min baad ka time chuno. | Error popup: "Please pick a time at least **20** minutes from now." | |
| F3 | Usi mein 25 min baad ka time chuno. | Booking allow ho jati hai aur schedule confirm hota hai. | |
| F4 | Admin ne value **45 min** wapas ki ho. 30 min baad ka time chuno. | Error mein clearly "**45**" likha aata hai. | |
| F5 | Admin ne value **90 min** ki ho. 60 min baad ka time chuno. | Error mein clearly "**90**" likha aata hai. | |

---

## 5. Pickup ETA aur Free Cancellation (Section H)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| H1 | Booking karo, driver accept kare. Customer app tracking screen dekho. | "Arriving at pickup in **X min**" aur "**N km away · by hh:mm**" dikhta hai. (X = Google ETA + Admin Buffer). | |
| H2 | Admin buffer change hone ke baad nayi booking karo. | Naya buffer jud kar accurate ETA display hota hai. | |
| H4 | Driver deadline tak pickup se door rahe. Customer app kholi rakho, kuch mat dabao. | Deadline cross hote hi screen par apne aap: "Driver is running late. You can cancel for free." dikhta hai. | |
| H5 | H4 ke baad **Cancel** button dabao. | Dialog mein "cancel for free" confirm hota hai. Order bina charge cancel ho jata hai. | |
| H6 | H5 ke baad customer ka **Wallet History** dekho. | Cancellation fee ka koi debit **nahi** hota. Agar premium plan hai to free cancel quota kam nahi hota. | |
| H8 | Driver deadline **se pehle** normal cancel karo. | Normal cancellation rules lagte hain (policy ke mutabiq fee lag sakti hai). | |
| H9 | Driver deadline ke baad pickup par pahunch jaye (arrived mark kare). | Ab "Driver is late" wali state hat jati hai, free cancel option band ho jata hai. | |
| H10 | Scheduled booking karo jo time par driver accept kare. | Pickup ETA normal orders ki tarah accurately dikhta hai. | |

---

## 6. Plans & Regression Check (Section G & I)

| ID | Kya karna hai | Expected | Result |
|---|---|---|---|
| G1 | Customer app se Premium Plan kharido (Razorpay). | Payment successful, plan active hota hai, benefits profile/home par reflect hote hain. | |
| I1 | Normal booking flow: Booking → Driver Accept → Advance Pay (Razorpay) → Ride Complete. | Flow smooth ho, tracking sahi chale, wallet history accurate ho. | |
| I2 | Wallet Top-up / Recharge (Razorpay). | Paisa wallet mein instantly credit hota hai. | |
| I3 | Customer cancel (driver accept ke baad, par ETA deadline se pehle). | Normal cancel confirmation aur notification aate hain. | |
