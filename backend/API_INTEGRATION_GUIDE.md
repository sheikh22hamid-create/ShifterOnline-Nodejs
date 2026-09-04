# Shifter Online — API Integration Guide (Customer App + Driver App)

This document is for the mobile app developer(s) wiring up the **Customer app** and **Driver app** to this Node.js backend. It covers every REST API and every Socket.io event those two apps need — nothing about the admin panel (that's a separate system).

Written in plain language on purpose — no need to read the backend source code to use this.

---

## 1. The Big Picture

- The backend is **one Node.js server** that does two things at the same time:
  1. **REST APIs** (normal HTTP requests) — for actions like "place an order", "get fare estimate", "cancel order".
  2. **Socket.io (WebSocket)** — for anything real-time: sending an order popup to a driver, a driver accepting/rejecting, live location tracking, order status changes.
- **Use REST for one-time actions.** Use **sockets for anything that needs to happen instantly / live** (popups, tracking, status changes).
- Base URL: `http://<server-host>:<port>` (default port `5000`, from `PORT` env var). All REST routes below are relative to this, e.g. `POST /api/order/create`.
- Socket.io connects to the **same host/port**, no separate URL.

### ⚠️ Important: there is NO login/auth API here
This backend does not have its own login/signup/OTP endpoints for the customer or driver app. It trusts whatever `uid` (customer id) or `rider_id` (driver id) you send it — there's no token check. Login/signup/OTP must still go through wherever it currently does (the older PHP system), and the app just needs to hang on to the `uid` / `rider_id` it gets from that, then pass it into every call below.

This is a known, deliberate gap for now — don't try to "fix" it on your own, just be aware every API call below is trusting the id you send it.

---

## 2. Response Format — two shapes, both used

Some endpoints (order-related, legacy-style) return:
```json
{ "ResponseCode": "200", "Result": "true", "ResponseMsg": "...", ...other fields }
```
Others (newer, rider/location-related) return:
```json
{ "Result": true, "msg": "...", ...other fields }
```
Note `Result` is sometimes the **string** `"true"`/`"false"` and sometimes the **boolean** `true`/`false` — check which style an endpoint uses (marked below) and compare accordingly, don't assume one way everywhere.

All errors return an HTTP error status (400/404/500) with a `msg` or `ResponseMsg` explaining what went wrong.

---

## 3. Customer App — REST APIs

### 3.1 Get vehicle categories
`GET /api/order/categories`

Returns the list of vehicle types (Bike, 3 wheeler, 4 wheeler, E loader) to show on the "choose category" screen.

**Response:**
```json
{ "Result": true, "categories": [{ "id": 1, "cat_name": "Bike" }, ...] }
```

### 3.2 Get fare estimate (call this before creating an order)
`POST /api/order/fare-estimate`

Given a category and pickup/drop coordinates, returns every available **package/model** for that category with its estimated price. This is what powers the "Model 1 / Model 2 / Model 3..." selection screen.

**Request body:**
```json
{ "cat_id": 1, "plat": 22.74, "plong": 75.91, "dlat": 22.71, "dlong": 75.88 }
```

**Response:**
```json
{
  "Result": true,
  "distance_km": 5.42,
  "duration_min": 11,
  "packages": [
    { "package_id": 6, "title": "Model 1", "min_charge": 30, "per_km_charge": 8, "estimated_fare": 73.36, "is_night": false },
    { "package_id": 7, "title": "Model 2", "min_charge": 40, "per_km_charge": 10, "estimated_fare": 94.2, "is_night": false }
  ]
}
```
Show the customer these package options (with prices) and let them tick which ones they're okay with (this becomes `delivery_type` below — customers can select more than one, in "any of these is fine" order of preference by price).

### 3.3 Create an order
`POST /api/order/create`

This is what actually books the ride and kicks off driver search. **Call `fare-estimate` first** — the `delivery_type` ids you send must be real, active package ids for the chosen category, or this call fails.

**Request body (all the fields the legacy app already sends):**
```json
{
  "uid": 15,
  "category": "Bike",
  "delivery_type": [6, 7, 21],
  "booking_type": 1,
  "plat": 22.74, "plong": 75.91, "paddress": "Pickup address text",
  "pick_name": "Customer Name", "pmobile": "9999999999", "pick_type": "Current Location",
  "dlat": 22.71, "dlong": 75.88, "daddress": "Drop address text",
  "drop_name": "Receiver Name", "dmobile": "9999999999", "drop_type": "Home",
  "package_weight": 2.5, "package_cost": 500, "description": "Optional note",
  "p_method_id": 1, "transaction_id": "cash_payment_12345",
  "extra_mile_charge": 0, "cou_id": 0, "cou_amt": 0,
  "radius_km": 5, "city_id": 1,
  "photos": "images/order_photos/xyz.jpg"
}
```
Key points:
- `delivery_type` is an **array of package ids** — every model the customer is okay with, in any order (the server always tries the cheapest one first regardless of the order you send).
- `photos` is optional, and is the `path` string you get back from the photo-upload API (§3.6) — upload the photo(s) first, then pass the path(s) here.
- The response comes back **immediately** — it does not wait for a driver. What happens next (driver search, acceptance) all arrives over the **socket** (see §5).

**Response:**
```json
{ "ResponseCode": "200", "Result": "true", "order_id": 1234, "booking_type": 1, "ResponseMsg": "Package Order Placed Successfully!!!" }
```
Save `order_id` — you need it for everything else (tracking, cancel, rate).

### 3.4 Get order details
`POST /api/order/details`

**Request:** `{ "uid": 15, "order_id": 1234 }`

**Response:**
```json
{
  "ResponseCode": "200", "Result": "true",
  "OrderProductList": [{
    "order_id": 1234, "rider_id": 8, "rider_name": "Ramesh Kumar", "rider_mobile": "9999908008",
    "vehicle_no": "MP13A0008", "rider_lats": "22.74", "rider_longs": "75.91",
    "Order_Status": "Processing", "Order_flow_id": 1, "otp": 3729,
    "total_Delivery_charge": "223.95"
  }]
}
```
See §7 for what `Order_Status` / `Order_flow_id` values mean.

### 3.5 Cancel an order
`POST /api/order/customer-cancel`

**Request:** `{ "uid": 15, "order_id": 1234, "comment": "Changed my mind" }` (`comment` optional)

**Response:** `{ "ResponseCode": "200", "Result": "true", "ResponseMsg": "Order Cancelled Successfully!!!" }`

Fails with 400 if the order is already Completed/Cancelled, or already picked up by a driver in a state that's past cancelling.

### 3.6 Upload a photo (for order description / proof)
`POST /api/order/upload-photo` — **multipart/form-data**, field name must be `photo`.

**Response:** `{ "Result": true, "path": "images/order_photos/1234567_abcd1234.jpg" }`

Use this `path` value as-is in `photos` when creating the order (§3.3). Max 5MB, image files only (jpg/jpeg/png/webp).

### 3.7 Rate a completed order
`POST /api/order/rate`

**Request:** `{ "uid": 15, "order_id": 1234, "rider_id": 8, "star": 5, "comment": "Great service" }` (`comment` optional)

**Response:** `{ "ResponseCode": "200", "Result": "true", "ResponseMsg": "Rating submitted successfully!" }`

### 3.8 Address search / autocomplete
`GET /api/location/search?q=<search text>`

Free-text location search (for the pickup/drop address picker). No `uid` needed — this just proxies a geocoding service.

**Response:** `{ "Result": true, "suggestions": [{ "title": "...", "description": "...", "lat": 22.74, "lng": 75.91 }] }`

---

## 4. Driver App — REST APIs

### 4.1 Get this driver's model/delivery-type toggles
`GET /api/rider/:riderId/delivery-types`

Returns every package/model for the driver's own vehicle category, with `enabled: true/false` for each — this is what powers the driver's "which order types do I want to receive" settings screen.

**Response:**
```json
{
  "Result": true, "vehicle": "Bike",
  "packages": [
    { "package_id": 6, "title": "Model 1", "enabled": true },
    { "package_id": 7, "title": "Model 2", "enabled": false }
  ]
}
```

### 4.2 Toggle one model on/off for this driver
`POST /api/rider/delivery-type`

**Request:** `{ "rider_id": 8, "package_id": 7, "enabled": false }`

**Response:** `{ "Result": true, "msg": "Updated" }`

A driver with a model **disabled** will never be offered that model for any order, on any of that order's tiers.

### 4.3 Go online / offline
`POST /api/rider/status`

**Request:** `{ "rider_id": 8, "a_status": 1 }` — `1` = online (can receive orders), `0` = offline.

**Response:** `{ "Result": true, "msg": "Status updated" }`

### 4.4 Update location (REST fallback)
`POST /api/rider/location`

**Request:** `{ "rider_id": 8, "lat": 22.74, "lng": 75.91 }`

**Response:** `{ "Result": true, "msg": "Location updated" }`

Only use this if the app genuinely can't keep a socket connection open. **Prefer the `driver:location_ping` socket event (§6.2)** while a trip is active — it's what actually drives live tracking on the customer's map; this REST endpoint only updates the driver's stored position, it does not broadcast to anyone.

---

## 5. Socket.io — Connecting

Both apps connect to the same server over Socket.io (not a different URL — same host/port as the REST APIs).

```js
const socket = io("http://<server-host>:<port>");
```

### Driver app, right after connecting:
```js
socket.emit("driver:join", { rider_id: 8 });
```
This puts the driver's socket into a private room (`driver_<rider_id>`) — every order popup and dismiss event for this driver arrives here. **Do this every time the socket (re)connects**, not just once — a dropped/reconnected socket needs to re-join.

When the app is closing / going to background in a way that should stop receiving popups:
```js
socket.emit("driver:leave", { rider_id: 8 });
```

### Customer app, right after connecting:
```js
socket.emit("customer:join", { user_id: 15, order_id: 1234 }); // order_id optional
```
`order_id` is optional — pass it if the customer is actively viewing a specific order's tracking screen (this joins that order's live-tracking room directly). If omitted, the server automatically finds and re-joins the customer's own most-recent active order, so a reconnect mid-trip doesn't lose tracking.

---

## 6. Socket.io — Driver App Events

### 6.1 Events the driver app SENDS

**`order:accept`** — driver taps "Accept" on a popup.
```js
socket.emit("order:accept", { rider_id: 8, order_id: 1234 });
```
Listen for the ack:
```js
socket.on("order:accept:ack", ({ Result, msg }) => { ... });
```
`Result: false` means someone else got it first, or the popup already expired — show "order no longer available" and remove the popup. **This is first-come-first-served**, so always be ready for a rejection here even if the popup was still showing.

**`order:reject`** — driver taps "Reject"/"Ignore" (or the countdown timer runs out client-side — but see the note below).
```js
socket.emit("order:reject", { rider_id: 8, order_id: 1234 });
```
No ack for this one. ⚠️ **Important**: rejecting one model of an order removes the driver from **every** model of that same order — the driver won't be offered Model 2/3/4/5 of that order either, even if those are enabled for them. This is intentional (a driver who says no once shouldn't be pestered again for the same delivery).

Also important: **send `order:reject` if the socket reconnects and the popup is still showing but you're not sure if the reject went through** — don't just let it silently disappear. A reject that never reaches the server means the driver stays "locked" on that popup until it naturally expires (up to 15s), which can make Model 2+ wait longer than it should.

**`order:status_update`** — driver moves the trip forward (arrived at pickup, picked up & en route, completed).
```js
socket.emit("order:status_update", { rider_id: 8, order_id: 1234, status: "arrived" });
```
`status` is one of: `"arrived"` → `"pickup"` → `"complete"` (must be sent in this order; each one is a real state transition on the server, not just a label).
Listen for the ack:
```js
socket.on("order:status_update:ack", ({ Result, msg }) => { ... });
```

**`driver:location_ping`** — send this repeatedly (e.g. every 3-5 seconds) while a trip is active, so the customer sees live movement on their map.
```js
socket.emit("driver:location_ping", { rider_id: 8, order_id: 1234, lat: 22.74, lng: 75.91, heading: 90 });
```

### 6.2 Events the driver app RECEIVES

**`order:request`** — a new order popup. Show this to the driver with a **15-second countdown** (the exact duration is in the payload itself as `popup_duration`, in seconds — always use that value, don't hardcode 15).
```json
{
  "type": "order",
  "order_id": "1234",
  "package_id": "6",
  "package_name": "Model 1",
  "model_name": "Model 1",
  "category": "Bike",
  "customer_name": "Rahul Sharma",
  "customer_phone": "9876543210",
  "pickup_address": "Rohini Sector 7",
  "pickup_latitude": "28.704059",
  "pickup_longitude": "77.102490",
  "delivery_address": "Connaught Place",
  "delivery_latitude": "28.613939",
  "delivery_longitude": "77.209021",
  "distance_km": "15.4",
  "distance": "15.4",
  "estimated_earning": "120.50",
  "driver_earning": "120.50",
  "trip_total": "120.50",
  "pickup_time": "2026-09-04T10:00:00.000Z",
  "order_details": "Bike (Model 1) - 2.5",
  "popup_duration": "15"
}
```
⚠️ The **same driver can receive multiple `order:request` popups for different orders at the same time** — always key your popup UI/state off `order_id` (+ `package_id` if you need to distinguish tiers), never assume "there's only ever one popup."

**`order:dismiss`** — the current popup should be closed, driver did not win/keep it.
```json
{ "order_id": "1234", "reason": "timeout" }
```
`reason` is one of: `"timeout"` (15s ran out), `"accepted_by_other"` (another driver got it), `"cancelled_by_user"` (customer cancelled while it was still popping up). Just close the popup silently — no need to show different UI per reason unless you want to.

**`order:assigned`** *(sent to the customer, not the driver — listed in §7, mentioned here for completeness since it's the mirror event of `order:accept`)*.

**`order:status_update:ack`, `order:accept:ack`** — see §6.1, these are direct replies to the driver's own actions.

**Push notifications (FCM), for when the app is backgrounded:** the same `order:request` and `order:dismiss` events are also sent as Firebase push notifications (not just sockets) with the same field names in the data payload, plus a `type` field: `"order"` for a new request, `"order_dismiss"` for a dismiss. Handle both the socket event and the push data payload — whichever fires first should show/hide the popup; don't require both.

---

## 7. Socket.io — Customer App Events

### 7.1 Events the customer app SENDS

**`driver:location_ping`** is driver-only. The customer app doesn't send trip-related events — it's purely a **listener** for order lifecycle updates once an order is placed via REST (§3.3).

### 7.2 Events the customer app RECEIVES

**`order:assigned`** — a driver accepted the order.
```json
{
  "order_id": 1234, "rider_id": 8, "rider_name": "Ramesh Kumar", "rider_phone": "9999908008",
  "profile_picture": "...", "vehicle_no": "MP13A0008",
  "rider_lat": 22.74, "rider_lng": 75.91,
  "otp": 3729, "order_status": 1, "o_status": "Processing"
}
```
Show the driver's details + start listening for `driver:location_stream` for live tracking. `otp` is what the customer reads out to the driver at pickup — keep it visible on the tracking screen.

**`driver:location_stream`** — live driver location while a trip is active.
```json
{ "order_id": 1234, "lat": 22.74, "lng": 75.91, "heading": 90 }
```

**`order:status_changed`** — trip moved to a new stage (arrived at pickup, or picked up & en route).
```json
{ "order_id": 1234, "order_status": 2, "o_status": "Pickup" }
```

**`order:completed`** — trip finished.
```json
{ "order_id": 1234, "order_status": 5, "o_status": "Completed" }
```
Prompt the customer to rate the trip (§3.7) once this arrives.

**`order:no_driver_found`** — nobody accepted after trying every model the customer allowed. Show a clear "no driver found, please try again" message — the order is now Cancelled server-side (matches what `/api/order/details` would show).
```json
{ "order_id": "1234" }
```

---

## 8. Order Status Reference

`o_status` (text) and `order_status` (number) always move together — use whichever your screen finds more convenient:

| `order_status` | `o_status` | Meaning |
|---|---|---|
| 0 | Pending | Order placed, still searching for a driver |
| 1 | Processing | A driver accepted, heading to pickup |
| 2 | Pickup | Driver has arrived at pickup location |
| 3 | On Route | Package picked up, driver en route to drop |
| 5 | Completed | Trip finished |
| 4 | Cancelled | Cancelled (by customer, or no driver found) |

Note the numbering isn't sequential (5 = Completed, 4 = Cancelled) — that's an existing quirk of the database, not a typo.

---

## 9. Package / Model Reference

Standard Bike category models (other categories have their own package ids/titles — always get the real list from §3.2 `fare-estimate` or §4.1, never hardcode ids beyond these five for display purposes):

| `package_id` | Model name |
|---|---|
| 6 | Model 1 |
| 7 | Model 2 |
| 21 | Model 3 |
| 33 | Model 4 |
| 34 | Model 5 |

When a customer selects multiple models at order time, the server always offers drivers the **cheapest selected model first**, then the next, etc. — regardless of what order the app sent them in.

---

## 10. Full Flow, Start to Finish

**Customer side:**
1. `GET /api/order/categories` → show vehicle types.
2. `POST /api/order/fare-estimate` → show model options + prices for the chosen category/route.
3. (optional) `POST /api/order/upload-photo` → get a `path` for any order photo.
4. `POST /api/order/create` → get `order_id` back immediately.
5. Connect socket, `customer:join`, then wait for either `order:assigned` or `order:no_driver_found`.
6. Once assigned: listen to `driver:location_stream`, `order:status_changed`, `order:completed`.
7. After completion: `POST /api/order/rate`.
8. At any point before assignment/completion: `POST /api/order/customer-cancel` if the customer wants out.

**Driver side:**
1. Connect socket, `driver:join` (every connect/reconnect).
2. `POST /api/rider/status` with `a_status: 1` to go online.
3. Listen for `order:request` → show popup with countdown from `popup_duration`.
4. On accept: `socket.emit("order:accept", ...)`, wait for `order:accept:ack`. On success, drive to pickup.
5. `socket.emit("driver:location_ping", ...)` repeatedly while the trip is active.
6. At pickup: `order:status_update` with `status: "arrived"`, then `status: "pickup"` once the package is collected.
7. At drop: `order:status_update` with `status: "complete"`.
8. On reject/ignore: `socket.emit("order:reject", ...)`.

---

## 11. Things to double check with backend before going live

- No auth on any of these endpoints yet (see §1) — flag this if the app is going to a wider audience before that's addressed.
- FCM push notifications require the driver/customer's `fcm_token` to already be saved against their `tbl_rider`/`tbl_user` row (however that's currently being set — check with backend if this app hasn't been wired to do that yet).
- `radius_km` in order creation is the customer's actual selected search radius in km — send the real number, don't leave it as a package rate or other unrelated value.
