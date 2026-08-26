# 🚀 Shifter Online — Real-Time Node.js & WebSocket Order Flow Engine
### Master Technical Specification & Implementation Prompt for Claude / Senior Backend Engineer

---

## 📌 1. System Overview & Executive Summary

This document specifies the complete architecture, database interactions, dispatch cascade pipeline, concurrency handling, REST APIs, and WebSocket events required to build a **dedicated, high-performance, real-time Order & Dispatch Microservice** in **Node.js (Express + Socket.io + Prisma / MySQL2)** for **Shifter Online**.

### 🎯 Core Objectives:
1. **100% Elimination of HTTP Polling**: Completely replace `check_driver.php` and `map_info.php` polling with bidirectional WebSockets (`Socket.io`).
2. **5-Second Overlapping Batch Dispatch Cascade**: Staggered multi-tier model dispatch with server-authoritative 15-second popup countdowns.
3. **Atomic Concurrency & Race-Condition Prevention**: Zero double-bookings, atomic locks on driver popup allocations, and race-free accept/cancel handling.
4. **Shared Database Compatibility**: Seamlessly integrate with the existing Hostinger MySQL database (`pkg_order`, `tbl_rider`, `tbl_package`, `tbl_order_requests`, etc.) while PHP admin panel continues running in parallel.

---

## 🗄️ 2. Database Connection & Existing Schema

### 2.1 Connection Details (Live Hostinger MySQL)
```env
DATABASE_URL="mysql://<redacted>:<redacted>@srv2206.hstgr.io:3306/u755836427_shifteronline"
DB_HOST="srv2206.hstgr.io"
DB_PORT=3306
DB_USER="<redacted>"
DB_PASSWORD="<redacted>"
DB_NAME="u755836427_shifteronline"
```
> Real credentials live only in `backend/.env` (gitignored) — never commit them here.

### 2.2 Core Database Tables & Their Roles

| Table Name | Critical Columns & Purpose |
| :--- | :--- |
| **`pkg_order`** | `id`, `uid`, `rid` (0 if unassigned), `o_status` ('Pending', 'Processing', 'Pickup', 'On Route', 'Completed', 'Cancelled'), `order_status` (0: Pending, 1: Accepted, 2: Arrived, 3: On Route, 5: Completed, 4: Cancelled), `plat`, `plong`, `dlat`, `dlong`, `paddress`, `daddress`, `category`, `delivery_type`, `allowed_delivery_types` (JSON), `current_package_step`, `d_charge`, `total_dcharge`, `otp`, `loading_charge`, `unloading_charge`, `service_charge`, `free_waiting_time`, `wating_charge`, `radius_charge`, `driver_earning`, `accept_time`, `ddate`. |
| **`tbl_rider`** | `id`, `first_name`, `last_name`, `fmobile`, `profile_picture`, `vehicle` ('Bike', '3 wheeler', '4 wheeler', 'E loader'), `vehicle_no`, `rlats`, `rlongs`, `a_status` (1=Online, 0=Offline), `status` (1=Approved/Active, 0=Blocked), `fcm_token`, `wallet_balance`. |
| **`tbl_rider_delivery_type`** | `rider_id`, `delivery_type` (Package ID), `status` (1=Enabled, 0=Disabled). |
| **`tbl_package`** | `id`, `cat_id`, `title` ('Model 1', 'Model 2', etc.), `min_charge`, `per_km_charge`, `service_charge_percent`, `night_charge_percent`, `driver_per_percent`, `driver_per_trip`, `cancellation_charge_customer`, `cancellation_charge_driver`, `free_waiting_time`, `waiting_charge`, `sort_order`, `status`. |
| **`pkg_category`** | `id`, `cat_name` ('Bike', '3 wheeler', '4 wheeler', 'E loader'), `cat_status` (1=Active). |
| **`tbl_order_requests`** | `id`, `order_id`, `rider_id`, `package_id`, `status` ('sent', 'accepted', 'auto_rejected', 'timeout', '10'=rejected), `lat`, `lng`, `created_at`. |
| **`pkg_order_wait_timer`** | `id`, `order_id`, `rid`, `pickup_wait_start`, `pickup_wait_end`, `pickup_wait_seconds`, `drop_wait_start`, `drop_wait_end`, `drop_wait_seconds`, `total_wait_seconds`, `pickup_distance`, `drop_distance`, `total_distance`. |
| **`tbl_favorite_driver`** | `user_id`, `rider_id`, `status` (1=Active). Favorite drivers receive top priority. |
| **`tbl_wallet_history`** | `user_id`, `mobile`, `amount`, `type` ('credit'/'debit'), `remark`, `payment_id`, `wallet_type` ('user'/'driver'). |
| **`order_status_history`** | `order_id`, `rider_id`, `status`, `remark`, `created_at`. |

---

## ⚡ 3. Real-Time Dispatch Cascade Engine (5s Step, 15s Popup Pipeline)

### 3.1 Timeline Architecture (Overlapping Batches)

When an order is created with `category = 'Bike'` and `allowed_delivery_types = [6, 7, 21, 33, 34]` (Model 1 to Model 5):

```
TIME 0s:
├── BATCH 1 (Model 1 - Package ID 6)
│   ├── Select up to 4 nearest eligible drivers [A, B, C, D]
│   ├── Emit socket 'order:request' with popup_duration = 15s
│   └── Set Server Timer: 15s expiry for Batch 1
│
├── ⏳ Server schedules Batch 2 trigger at T = 5s
│
TIME 5s:
├── BATCH 1 is STILL ACTIVE (10s left for Drivers A, B, C, D)
├── BATCH 2 (Model 2 - Package ID 7)
│   ├── Select 4 NEW eligible drivers [E, F, G, H] (excluding busy A, B, C, D)
│   ├── Update pkg_order price to Model 2 rate card
│   ├── Emit socket 'order:request' with popup_duration = 15s
│   └── Set Server Timer: 15s expiry for Batch 2
│
├── ⏳ Server schedules Batch 3 trigger at T = 10s
│
TIME 10s:
├── BATCH 1 has 5s left
├── BATCH 2 has 10s left
├── BATCH 3 (Model 3 - Package ID 21)
│   ├── Select 4 NEW eligible drivers [I, J, K, L]
│   └── Emit socket 'order:request' with popup_duration = 15s
│
TIME 15s:
├── ⏰ BATCH 1 EXPIRES:
│   ├── Drivers [A, B, C, D] popup automatically closes ('order:dismiss')
│   ├── Batch 1 records in tbl_order_requests updated to 'timeout'
│   └── Drivers [A, B, C, D] released back into global pool
├── BATCH 2 has 5s left
├── BATCH 3 has 10s left
├── BATCH 4 (Model 4 - Package ID 33)
│   └── Select 4 eligible drivers (A, B, C, D can now be re-selected if Model 4 is enabled)
│
TIME 20s:
├── ⏰ BATCH 2 EXPIRES (Drivers E, F, G, H released)
├── BATCH 5 (Model 5 - Package ID 34) -> Final 4 Drivers
│
TIME 35s:
├── ⏰ BATCH 5 EXPIRES
├── ALL TIERS EXHAUSTED -> No driver accepted
└── Emit socket 'order:no_driver_found' to Customer -> Mark order in DB
```

---

## 🛡️ 4. Critical Edge Cases, Concurrency & State Management Rules

### 1. One Driver = One Popup at a Time (Global Driver Lock)
- Maintain an in-memory / Redis map: `active_driver_popups: Map<rider_id, { order_id, expires_at }>`
- When searching for eligible drivers, a driver is **strictly excluded** if `active_driver_popups.has(rider_id) && active_driver_popups.get(rider_id).expires_at > Date.now()`.
- Once their 15s timer expires or they click "Reject", the lock is instantly released.

### 2. Multi-Booking Selection Race Conditions
- Use an atomic mutex/lock during the driver query and selection phase so two concurrent bookings never select the same driver simultaneously.

### 3. Server-Authoritative 15s Popup Timer
- The popup timer is **not** client-controlled. The server holds an active `setTimeout` for 15,000ms.
- If a driver's accept packet arrives at 15.001s, the server rejects it with `"Request timed out"`.

### 4. Re-eligibility & Anti-Spam Priority
- Once a driver's 15s timer expires without accepting, they re-enter the pool.
- Priority order for selection in subsequent batches:
  1. Favorite Drivers (`tbl_favorite_driver`) who have not yet received this order.
  2. Un-notified eligible drivers in the 10km radius.
  3. Previously notified drivers whose 15s timeout has passed (if no new drivers exist).

### 5. Atomic Acceptance (First-Come, First-Served)
- Use a SQL Atomic Conditional Update transaction:
  ```sql
  UPDATE pkg_order
  SET rid = :rider_id,
      order_status = 1,
      o_status = 'Processing',
      accept_time = NOW()
  WHERE id = :order_id AND rid = 0 AND order_status = 0 AND o_status != 'Cancelled';
  ```
- Check `affectedRows === 1`:
  - **If 1**: Acceptance successful! Calculate `driver_earning`, mark `tbl_order_requests` status `'accepted'` for this driver and `'auto_rejected'` for all others. Cancel all pending batch timers for this order. Broadcast `order:assigned` to Customer and `order:dismiss` to all other drivers.
  - **If 0**: Order already taken or cancelled. Return `{ "Result": false, "msg": "Order already taken or cancelled" }`.

### 6. Concurrent Customer Cancel vs Driver Accept
- If Customer clicks Cancel while Driver clicks Accept:
  - Whichever SQL update executes first wins atomically.
  - If Cancel succeeds first (`o_status = 'Cancelled'`), the driver's accept query returns `affectedRows === 0` and rejects the driver.
  - If Accept succeeds first, the cancel API treats it as an assigned cancellation and applies customer cancellation penalties.

### 7. Fewer Than 4 Drivers Available
- If only 1, 2, or 3 drivers are found in radius for that model tier, dispatch to all available without waiting. Continue the 5-second cascade to the next tier.

### 8. App Closed / Internet Lost on Driver Device
- When server timer hits 15s, it automatically updates `tbl_order_requests` to `'timeout'`, frees the driver lock, and emits cleanup events.

---

## 📡 5. Complete REST API Specifications

### Base URL: `http://localhost:5000/api` (or domain)

---

### 1. Fare Estimate & Rate Card
- **Endpoint**: `POST /api/order/fare-estimate`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "uid": 7,
    "cat_id": 8,
    "plat": 28.704059,
    "plong": 77.102490,
    "dlat": 28.613939,
    "dlong": 77.209021
  }
  ```
- **Response Body (200 OK)**:
  ```json
  {
    "Result": true,
    "distance_km": 15.4,
    "duration_min": 35,
    "packages": [
      {
        "package_id": 6,
        "title": "Model 1",
        "min_charge": 23.96,
        "per_km_charge": 6.75,
        "estimated_fare": 127.91,
        "is_night": 0
      },
      {
        "package_id": 7,
        "title": "Model 2",
        "min_charge": 25.50,
        "per_km_charge": 7.25,
        "estimated_fare": 137.15,
        "is_night": 0
      }
    ]
  }
  ```

---

### 2. Place / Create Order
- **Endpoint**: `POST /api/order/create`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "uid": 7,
    "category": "Bike",
    "delivery_type": [6, 7, 21, 33, 34],
    "booking_type": 1,
    "plat": 28.704059,
    "plong": 77.102490,
    "paddress": "Rohini Sector 7, New Delhi",
    "pick_name": "Rahul Sharma",
    "pmobile": "9876543210",
    "pick_type": "Home",
    "dlat": 28.613939,
    "dlong": 77.209021,
    "daddress": "Connaught Place, New Delhi",
    "drop_name": "Amit Verma",
    "dmobile": "9811223344",
    "drop_type": "Office",
    "package_weight": "5 Kg",
    "package_cost": 500,
    "description": "Documents Delivery",
    "p_method_id": 1,
    "transaction_id": "cash_payment",
    "extra_mile_charge": 0,
    "cou_id": 0,
    "cou_amt": 0
  }
  ```
- **Response Body (200 OK)**:
  ```json
  {
    "ResponseCode": "200",
    "Result": "true",
    "order_id": 297,
    "booking_type": 1,
    "ResponseMsg": "Package Order Placed Successfully!!!"
  }
  ```

---

### 3. Get Order Details
- **Endpoint**: `POST /api/order/details`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "uid": 7,
    "order_id": 297
  }
  ```
- **Response Body (200 OK)**:
  ```json
  {
    "ResponseCode": "200",
    "Result": "true",
    "OrderProductList": [
      {
        "order_id": 297,
        "rider_id": 1,
        "rider_name": "Deepak Kumar",
        "rider_mobile": "8641011669",
        "vehicle_no": "DL 8S AB 1234",
        "rider_lats": "28.705500",
        "rider_longs": "77.103000",
        "Order_Status": "Processing",
        "Order_flow_id": 1,
        "otp": "4589",
        "total_Delivery_charge": "127.91"
      }
    ]
  }
  ```

---

### 4. Customer Cancel Order
- **Endpoint**: `POST /api/order/customer-cancel`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "uid": 7,
    "order_id": 297,
    "comment": "Booked by mistake"
  }
  ```
- **Response Body (200 OK)**:
  ```json
  {
    "ResponseCode": "200",
    "Result": "true",
    "ResponseMsg": "Order Cancelled Successfully!!!"
  }
  ```

---

### 5. Rate & Review Driver
- **Endpoint**: `POST /api/order/rate`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "uid": 7,
    "order_id": 297,
    "rider_id": 1,
    "star": 5,
    "comment": "On-time and professional!"
  }
  ```
- **Response Body (200 OK)**:
  ```json
  {
    "ResponseCode": "200",
    "Result": "true",
    "ResponseMsg": "Rating submitted successfully!"
  }
  ```

---

## 🔌 6. Complete WebSocket (Socket.io) Architecture & Events

### 6.1 Rooms Management
- `customer_<uid>`: Private room for customer notifications.
- `driver_<rider_id>`: Private room for individual driver request popups.
- `order_<order_id>`: Shared room for real-time tracking between customer and assigned driver.

---

### 6.2 Connection & Authentication
```javascript
// Driver Connects
socket.emit('driver:join', { rider_id: 1, lat: 28.704059, lng: 77.102490 });

// Customer Connects
socket.emit('customer:join', { user_id: 7, order_id: 297 });
```

---

### 6.3 Event Directory (Full Specs)

#### 📨 Server ➡️ Driver: `order:request`
*Emitted to 4 selected drivers when a batch triggers.*
```json
{
  "order_id": "297",
  "package_id": "6",
  "category": "Bike",
  "customer_name": "Rahul Sharma",
  "customer_phone": "9876543210",
  "pickup_address": "Rohini Sector 7, New Delhi",
  "pickup_latitude": "28.704059",
  "pickup_longitude": "77.102490",
  "delivery_address": "Connaught Place, New Delhi",
  "delivery_latitude": "28.613939",
  "delivery_longitude": "77.209021",
  "distance_km": "15.4",
  "driver_earning": "108.72",
  "popup_duration": 15
}
```

---

#### 📨 Driver ➡️ Server: `order:accept`
```json
{
  "rider_id": 1,
  "order_id": 297
}
```
**Server Action**:
- Executes atomic SQL update (`UPDATE pkg_order SET rid=1, order_status=1, o_status='Processing' WHERE id=297 AND rid=0`).
- If won: Cancels all dispatch timers for order 297. Emits `order:assigned` to customer, and `order:dismiss` to other 3 drivers.

---

#### 📨 Server ➡️ Driver: `order:dismiss`
*Emitted when another driver accepts, popup expires (15s), or customer cancels.*
```json
{
  "order_id": "297",
  "reason": "accepted_by_other" // or "timeout", "cancelled_by_user"
}
```

---

#### 📨 Server ➡️ Customer: `order:assigned`
*Emitted to Customer Room when driver accepts.*
```json
{
  "order_id": 297,
  "rider_id": 1,
  "rider_name": "Deepak Kumar",
  "rider_phone": "8641011669",
  "profile_picture": "images/rider_doc/profile.jpg",
  "vehicle_no": "DL 8S AB 1234",
  "rider_lat": 28.705500,
  "rider_lng": 77.103000,
  "otp": "4589",
  "order_status": 1,
  "o_status": "Processing"
}
```

---

#### 📨 Driver ➡️ Server ➡️ Customer: `driver:location_ping`
*Emitted by driver app every 3-5 seconds. Server broadcasts to `order_<order_id>` room (bypassing heavy DB writes).*
- **Driver to Server**:
  ```json
  {
    "rider_id": 1,
    "order_id": 297,
    "lat": 28.705600,
    "lng": 77.103100,
    "heading": 180
  }
  ```
- **Server to Customer (`driver:location_stream`)**:
  ```json
  {
    "order_id": 297,
    "lat": 28.705600,
    "lng": 77.103100,
    "heading": 180
  }
  ```

---

#### 📨 Driver ➡️ Server: `order:status_update`
*Handles trip status transitions:*
- **Status = `'arrived'`**:
  - Sets `order_status = 2`, `o_status = 'Pickup'`.
  - Starts wait timer in `pkg_order_wait_timer` (`pickup_wait_start = NOW()`).
  - Emits `order:status_changed` to customer.
- **Status = `'pickup'`**:
  - Sets `order_status = 3`, `o_status = 'On Route'`.
  - Freezes pickup wait timer (`pickup_wait_seconds = NOW - start`).
  - Emits `order:status_changed` to customer.
- **Status = `'complete'`**:
  - Sets `order_status = 5`, `o_status = 'Completed'`, `ddate = NOW()`.
  - Calculates chargeable wait time and final charges.
  - Debits admin commission if cash payment.
  - Emits `order:completed` to customer.

---

## 📁 7. Recommended Node.js Project Structure

```
shifter-order-engine/
├── src/
│   ├── config/
│   │   ├── db.js                 # Prisma Client or MySQL2 Connection Pool
│   │   ├── firebase.js           # FCM Admin SDK
│   │   └── constants.js          # POPUP_TIMEOUT=15, BATCH_GAP=5
│   ├── controllers/
│   │   ├── orderController.js    # REST Endpoints handlers
│   │   └── riderController.js    # Rider status & location handlers
│   ├── services/
│   │   ├── pricingEngine.js      # Distance Matrix & rate card math
│   │   ├── dispatchManager.js    # 5s-15s Overlapping Batch Cascade Manager
│   │   ├── lockManager.js        # Driver lock & concurrency mutex
│   │   └── tripLifecycle.js      # Arrived, Pickup, Complete, Refunds, Commission
│   ├── sockets/
│   │   ├── socketServer.js       # Socket.io initialization & room manager
│   │   ├── orderSocket.js        # order:request, accept, reject, dismiss handlers
│   │   └── trackingSocket.js     # driver:location_ping & broadcast stream
│   ├── routes/
│   │   └── orderRoutes.js        # Express REST Routes
│   ├── utils/
│   │   ├── geoDistance.js        # Haversine & Google Road Distance
│   │   └── logger.js
│   ├── app.js                    # Express App Setup & Middleware
│   └── server.js                 # HTTP Server & Socket.io Listen
├── prisma/
│   └── schema.prisma             # Generated via npx prisma db pull
├── .env
├── package.json
└── README.md
```

---

## 🏁 8. Implementation Checklist for Claude / Developer

1. [ ] Run `npx prisma db pull` to introspect existing Hostinger MySQL database.
2. [ ] Implement `geoDistance.js` with Google Distance Matrix API and Haversine fallback.
3. [ ] Build `dispatchManager.js` with overlapping timer queues (`setTimeout` with cancellation IDs).
4. [ ] Build `lockManager.js` to ensure 1 driver gets maximum 1 popup across all active searches.
5. [ ] Implement Atomic SQL transaction for `order:accept` to eliminate double-booking race conditions.
6. [ ] Implement Socket.io rooms (`customer_<uid>`, `driver_<rid>`, `order_<oid>`).
7. [ ] Implement trip lifecycle status machine (`arrived` ➡️ `pickup` ➡️ `complete` ➡️ `rate`).
8. [ ] Add FCM Push Notification fallback when driver socket is disconnected.
