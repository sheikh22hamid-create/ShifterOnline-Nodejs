# User & Role Architecture Document (Simple Guide)
**Platform:** On-Demand Logistics & Goods Transportation Platform (Porter-like System)  
**Document Code:** `ARCH-02-USER-ROLE-BLUEPRINT`  
**Target Audience:** Developers & Technical Team  

---

## 1. System Ke 5 Main Roles (Five Primary Roles)

System me strictly **5 Primary Roles** hain. Koi aur naya role (jaise Manager ya Operator) create nahi karna hai:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        5 PRIMARY SYSTEM ROLES                          │
├────────────────────────────────┬───────────────────────────────────────┤
│ ADMINISTRATIVE ROLES (Web)     │ OPERATIONAL ROLES (Mobile)            │
├────────────────────────────────┼───────────────────────────────────────┤
│ 1. `SUPER_ADMIN`(Global Master)│ 4. `USER` (Customer Booking App)      │
│ 2. `CITY_ADMIN` (City Manager) │ 5. `DRIVER` (Driver Partner App)      │
│ 3. `EXECUTIVE` (City Staff)    │                                       │
└────────────────────────────────┴───────────────────────────────────────┘
```

---

## 2. Role Hierarchy Diagram (Kaun Kiske Under Aata Hai?)

```mermaid
graph TD
    subgraph Administrative Hierarchy [Web Platform - React]
        SA[SUPER_ADMIN<br/>Global Owner]
        
        CA_Indore[CITY_ADMIN: Indore]
        CA_Bhopal[CITY_ADMIN: Bhopal]
        
        EX_Indore1[EXECUTIVE: KYC Desk]
        EX_Indore2[EXECUTIVE: Dispatch Desk]
        EX_Bhopal1[EXECUTIVE: Operations Desk]
        
        SA --> CA_Indore
        SA --> CA_Bhopal
        
        CA_Indore --> EX_Indore1
        CA_Indore --> EX_Indore2
        CA_Bhopal --> EX_Bhopal1
    end

    subgraph Operational Network [Mobile Platform - Flutter]
        Customer[USER<br/>Commercial Customer]
        DriverPartner[DRIVER<br/>Fleet Partner]
    end

    Customer -->|Creates Booking| Booking[(Active Trip)]
    Booking -->|Assigned via Backend| DriverPartner
    
    EX_Indore2 -.->|Monitors & Manual Assists| Booking
    EX_Indore1 -.->|Verifies KYC| DriverPartner
```

### Important Hierarchy Rules
1. **Administrative Line:** `SUPER_ADMIN` create karta hai `CITY_ADMIN` ko, aur `CITY_ADMIN` manage karta hai apne city ke `EXECUTIVE` ko.
2. **User aur Driver alag hain:** `USER` aur `DRIVER` administrative tree ke bacche (children) nahi hain. Wo independent commercial apps hain.
3. **City Governance:** Driver aur User jab kisi city me ride karte hain, to unpar us city ke `CITY_ADMIN` ke banaye hue Rate Cards aur Geofences apply hote hain.

---

## 3. Har Role Ki Detail Aur Responsibilities

### 3.1 `SUPER_ADMIN` (Global Master Control)
* **Kaha Login Karega:** React.js Web Admin Console.
* **Scope:** Poori country / saari cities ka global access.
* **Kaam Kya Hai:**
  - Nayi city add karna aur band karna.
  - `CITY_ADMIN` ke accounts banana.
  - Master commission percentage aur global payment gateway settings set karna.
  - Sabhi cities ki consolidated income aur audit logs dekhna.

### 3.2 `CITY_ADMIN` (City Head / Manager)
* **Kaha Login Karega:** React.js Web Admin Console.
* **Scope:** Sirf APNI city (`cityId`). Doosri city ka data nahi dekh sakta.
* **Kaam Kya Hai:**
  - Apni city ke Rate Cards set karna (Base fare, per KM charge, waiting charges, GST).
  - City ke Service Areas aur Geofence boundaries draw karna.
  - City ke `EXECUTIVE` staff ko invite karna aur unki permissions set karna.
  - Driver onboarding aur vehicle category availability approve karna.

### 3.3 `EXECUTIVE` (City Operational Staff)
* **Kaha Login Karega:** React.js Web Admin Console.
* **Scope:** Sirf apne parent `CITY_ADMIN` ki city (`cityId`).
* **Kaam Kya Hai:**
  - **KYC Verification:** Driver ke driving license, RC, insurance audit karke approve/reject karna.
  - **Owner Assist (Manual Dispatch):** Agar koi booking atak gayi hai to map par available driver ko manually ride assign karna.
  - **Dispute & Emergency Support:** In-transit truck breakdown hone par turant doosra driver bhejna.

### 3.4 `USER` (Commercial Customer)
* **Kaha Login Karega:** Flutter Mobile App (Android & iOS).
* **Scope:** Apna personal customer account (Global Roaming - Indore me bhi book kare, Bhopal me bhi).
* **Kaam Kya Hai:**
  - Phone OTP se login karna.
  - Pickup aur multiple drop points select karna.
  - Vehicle category choose karna (Bike, Auto, Tata Ace, 8ft Pickup, 14ft Truck).
  - Cargo details aur packet photos upload karna.
  - Driver ko live map par track karna aur delivery par secret OTP share karna.
  - Payment settle karna (Wallet, UPI, Card, ya Cash on Delivery).

### 3.5 `DRIVER` (Fleet Partner / Vehicle Operator)
* **Kaha Login Karega:** Flutter Mobile App (Android & iOS).
* **Scope:** Apna personal driver account aur vehicles.
* **Kaam Kya Hai:**
  - Phone OTP se register karke KYC documents upload karna.
  - Shift `ONLINE` karke background me high-frequency GPS pings bhejna (har 3 second me).
  - 15 second ka audio popup aane par Accept/Reject dabana.
  - Pickup par jakar cargo load karwana aur drop par User se OTP lekar delivery photo upload karna.
  - Apni daily earnings aur wallet balance check karna.

---

## 4. Web vs Mobile Platform Access Matrix

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        PLATFORM ACCESS MATRIX                          │
├───────────────┬────────────────────────────┬───────────────────────────┤
│ Role          │ Ingress Platform           │ Primary Device            │
├───────────────┼────────────────────────────┼───────────────────────────┤
│ `SUPER_ADMIN` │ React.js Web Admin Console │ Desktop / Laptop Browser  │
│ `CITY_ADMIN`  │ React.js Web Admin Console │ Desktop / Laptop Browser  │
│ `EXECUTIVE`   │ React.js Web Admin Console │ Desktop / Laptop Browser  │
│ `USER`        │ Flutter Mobile Application │ Android / iOS Smartphone  │
│ `DRIVER`      │ Flutter Mobile Application │ Android / iOS Smartphone  │
└───────────────┴────────────────────────────┴───────────────────────────┘
```

---

## 5. Driver Partner Ka Complete Lifecycle (State Machine)

Driver ka registration se lekar active trip tak ka state machine:

```mermaid
stateDiagram-v2
    [*] --> REGISTERED: Phone OTP verified
    REGISTERED --> KYC_SUBMITTED: Documents & RC uploaded
    
    KYC_SUBMITTED --> KYC_REJECTED: Executive rejects documents (Re-upload needed)
    KYC_REJECTED --> KYC_SUBMITTED: Driver fixes & re-uploads
    
    KYC_SUBMITTED --> APPROVED: Executive approves KYC
    
    APPROVED --> ACTIVE_OFFLINE: Initial shift state
    
    state Shift_Operations {
        ACTIVE_OFFLINE --> ACTIVE_ONLINE: Taps 'Go Online' (GPS Starts)
        ACTIVE_ONLINE --> ACTIVE_BUSY: Accepts Dispatch Popup
        ACTIVE_BUSY --> ACTIVE_ONLINE: Trip Completed & OTP verified
        ACTIVE_ONLINE --> ACTIVE_OFFLINE: Taps 'Go Offline'
    }
    
    Shift_Operations --> SUSPENDED: Penalty / Expired Docs / Fraud
    SUSPENDED --> ACTIVE_OFFLINE: Admin unblocks account
    
    Shift_Operations --> TERMINATED: Permanent Ban
    TERMINATED --> [*]
```

### Shift ke 3 States
1. `ACTIVE_OFFLINE`: Driver aaram kar raha hai. Location pings band hain. Dispatch me nahi dikhega.
2. `ACTIVE_ONLINE`: Driver duty par hai. Har 3s me Redis me GPS bhej raha hai. Nayi rides mil sakti hain.
3. `ACTIVE_BUSY`: Driver active trip me hai. Naye popups nahi aayenge jab tak trip khatam na ho.

---

## 6. Single-Device Security (Account Sharing Kaise Rokte Hain?)

Driver ya Customer ek time par **sirf ek hi phone me login** reh sakta hai:

```mermaid
sequenceDiagram
    autonumber
    actor Driver_Phone2 as Driver (New Phone B)
    participant API as Node.js Auth Backend
    participant Redis as Redis Session Cache
    actor Driver_Phone1 as Driver (Old Phone A)

    Driver_Phone2->>API: Verify OTP { phone, otp, deviceId_B }
    API->>API: Verify OTP Success
    API->>Redis: Check current active session for driver
    Note over API, Redis: Session found on Phone A!
    
    API->>Redis: Set active device = deviceId_B
    API->>Redis: Add Phone A token to Blacklist
    API-->>Driver_Phone2: Login Success (Token B)

    Note over Driver_Phone1, API: Phone A sends next GPS ping
    Driver_Phone1->>API: POST /driver/location (Using Token A)
    API->>Redis: Check Token A
    API-->>Driver_Phone1: 401 Unauthorized { code: 'LOGGED_IN_ON_OTHER_DEVICE' }
    Note over Driver_Phone1: Phone A immediately logs out!
```

---

## 7. Cross-Role Workflows (Roles Milkar Kaise Kaam Karte Hain?)

```mermaid
sequenceDiagram
    autonumber
    actor CityAdmin as CITY_ADMIN (City Manager)
    actor Executive as EXECUTIVE (Operations Desk)
    actor Driver as DRIVER (Fleet Partner)
    actor Customer as USER (Customer)

    Note over CityAdmin: 1. Setup Phase
    CityAdmin->>CityAdmin: Rate Cards & Geofences set karta hai
    CityAdmin->>Executive: Permissions assign karta hai

    Note over Driver, Executive: 2. KYC Onboarding Phase
    Driver->>Executive: Driving License & RC upload karta hai
    Executive->>Driver: Documents check karke APPROVED karta hai

    Note over Customer, Driver: 3. Trip Fulfillment Phase
    Customer->>Customer: Ride book karta hai
    Driver->>Customer: Popup accept karke pickup par pahunchta hai
    Customer->>Driver: OTP share karta hai -> Trip complete hoti hai

    Note over Driver, Executive: 4. Emergency "Owner Assist"
    opt In-Transit Breakdown
        Driver->>Executive: SOS / Breakdown alert bhejta hai
        Executive->>Driver: Doosre nearby driver ko manually ride reassign karta hai
    end
```

---

## 8. Summary of ADRs for Roles

* **ADR-008:** Exactly 5 Primary Roles (No role bloat).
* **ADR-009:** Admin on React Web, Customer & Driver on Flutter Mobile.
* **ADR-010:** Backend `cityId` isolation at repository layer.
* **ADR-011:** Single active device policy via Redis deviceId token binding.

---
*End of User & Role Architecture Document (`Architecture/02-User-Role-Architecture.md`)*
