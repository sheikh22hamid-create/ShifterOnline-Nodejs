# Customer App (ShifterOnlineFinal) Node/Socket Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the customer app's order-creation, driver-assignment, status-tracking, and cancel flows from legacy PHP polling to the Node backend's REST + Socket.io API, mirroring the driver app's already-shipped integration.

**Architecture:** A `NodeSocketManager` Dart singleton (one persistent `socket_io_client` connection, opened at login/session-restore, closed at logout) replaces `waiting_screen.dart`'s 8-second polling loop with `order:assigned`/`order:no_driver_found` listeners, and adds `order:status_changed`/`order:completed` listeners to `trackingway.dart` that re-trigger its existing REST detail-fetch functions. Order creation and cancel switch from `pks_order.php`/`pks_cancle.php` to Node's `/api/order/create` and `/api/order/customer-cancel`. One new backend endpoint (`POST /api/order/upload-photo`) replaces the old multipart photo upload since Node's create-order endpoint expects JSON, not multipart.

**Tech Stack:** Flutter (Dart), `socket_io_client` (new dependency), Node.js/Express backend (`multer`, new dependency), Socket.io v4, Prisma/MySQL.

**Spec:** `docs/superpowers/specs/2026-09-03-customer-app-node-socket-integration-design.md`

## Global Constraints

- **Photo upload** gets a small dedicated Node endpoint (`POST /api/order/upload-photo`, `multer`, single file per call) — the existing `pro_image.php` is for the user's *profile* photo, not reusable here.
- **Scheduled orders stay on the legacy PHP path entirely.** Discovered during planning: `orderController.createOrderCore` never writes `schedule_date_time` (or `loading_charge`/`unloading_charge`/`service_charge`/`free_waiting_time`) into `pkg_order` for *any* caller — this is a pre-existing gap in Node's create-order endpoint, not something this plan can safely fix (it would require new dispatch-timing infrastructure in `dispatchManager`, which always starts a dispatch cascade immediately on creation). Only immediate/on-demand orders (`selectedBookingType != 2`) route through the new Node path; scheduled orders (`selectedBookingType == 2`) keep using `pks_order.php` unchanged.
- **Package/fare listing** (the Model 1-5 picker, `packagelist.php`) stays exactly as-is — out of scope.
- **Live driver-location map tracking** stays exactly as-is — out of scope, not touched by this plan.
- **Payment** (Razorpay, wallet, etc.) stays on its current path — untouched.
- **Rating** (`rate.php`) is out of scope, matching the driver app's own scope boundary.
- Every legacy call this plan touches gets fully replaced, not left as dead code alongside a new path.
- No automated Flutter tests exist in this project (`flutter_test` dev dependency is present but unused, no `test/` directory) and the driver-app integration was verified the same way — each Flutter task's "test" step is `flutter analyze` (0 new errors/warnings introduced), with a final manual on-device E2E task closing out the plan. Backend (Node) tasks get real Jest tests, matching that codebase's existing convention.
- `ShifterOnlineFinal/pubspec.yaml` was missing at planning time and has since been restored (commit `8997397`) — no longer a blocker.

---

## Task 1: Backend fix — pass `photos` through on order creation

`orderController.createOrder` (the HTTP handler backing `POST /api/order/create`) currently hardcodes `photos: null` when calling `createOrderCore`, silently discarding any `photos` field sent in the request body — a pre-existing bug that would break Task 5's photo-upload flow before it even starts.

**Files:**
- Modify: `backend/src/controllers/orderController.js:209-248` (the `createOrder` function)
- Test: `backend/src/controllers/__tests__/orderController.test.js`

**Interfaces:**
- Produces: `createOrder(req, res)` now honors `req.body.photos` — Task 5's Flutter client can rely on a `photos` string field in its `/api/order/create` request body actually being persisted.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/controllers/__tests__/orderController.test.js`. First update the import line near the top of the file:

```js
const { createOrderCore, createOrder } = require("../orderController");
```

Then add this new `describe` block anywhere after the existing `describe("orderController.createOrderCore", ...)` block closes:

```js
describe("orderController.createOrder (HTTP handler) — photos pass-through", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 5 });
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, per_km_charge: 10, sort_order: 1 }]);
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 2 });
    pricingEngine.priceForPackage.mockReturnValue({ fare: 50, driverEarning: 40, commission: 5 });
    prisma.pkg_order.create.mockResolvedValue({ id: 777, booking_type: 1 });
  });

  it("passes req.body.photos through to the created order instead of discarding it", async () => {
    const req = {
      body: {
        uid: 1, category: "Bike", delivery_type: [6], booking_type: 1,
        plat: 28.7, plong: 77.1, paddress: "A", pick_name: "P", pmobile: "999", pick_type: "",
        dlat: 28.8, dlong: 77.2, daddress: "B", drop_name: "D", dmobile: "888", drop_type: "",
        package_weight: "2 Kg", package_cost: 100, description: "",
        p_method_id: 1, transaction_id: "", extra_mile_charge: 0, cou_id: 0, cou_amt: 0,
        radius_km: 10, city_id: 2,
        photos: "images/order_photos/abc123.jpg",
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await createOrder(req, res);

    expect(prisma.pkg_order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ photos: "images/order_photos/abc123.jpg" }) })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest orderController.test.js -t "photos pass-through"`
Expected: FAIL — `prisma.pkg_order.create` was called with `data.photos` equal to `null`, not `"images/order_photos/abc123.jpg"`.

- [ ] **Step 3: Fix the handler**

In `backend/src/controllers/orderController.js`, update the destructure at the top of `createOrder` (around line 211-215):

```js
    const {
      uid, category, delivery_type, booking_type, plat, plong, paddress, pick_name, pmobile, pick_type,
      dlat, dlong, daddress, drop_name, dmobile, drop_type, package_weight, package_cost, description,
      p_method_id, transaction_id, extra_mile_charge, cou_id, cou_amt, radius_km, city_id, photos,
    } = req.body;
```

Then update the `createOrderCore` call (around line 217-223) to pass it through instead of hardcoding `null`:

```js
    const result = await createOrderCore({
      uid, category, deliveryTypeIds: delivery_type, bookingType: booking_type, plat, plong, paddress,
      pickName: pick_name, pmobile, pickType: pick_type, dlat, dlong, daddress, dropName: drop_name,
      dmobile, dropType: drop_type, packageWeight: package_weight, packageCost: package_cost, description,
      pMethodId: p_method_id, transactionId: transaction_id, extraMileCharge: extra_mile_charge,
      couId: cou_id, couAmt: cou_amt, radiusKm: radius_km, cityId: city_id, photos: photos || null,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest orderController.test.js`
Expected: PASS (all tests in the file, including the new one and the pre-existing `createOrderCore` suite).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/orderController.js backend/src/controllers/__tests__/orderController.test.js
git commit -m "fix(backend): pass photos field through on order creation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016JdmgRqfr7YZKez3SWHH5N"
```

---

## Task 2: Backend — new order-photo upload endpoint

**Files:**
- Create: `backend/src/controllers/uploadController.js`
- Create: `backend/src/controllers/__tests__/uploadController.test.js`
- Modify: `backend/src/routes/orderRoutes.js`
- Modify: `backend/package.json` (add `multer` dependency)

**Interfaces:**
- Produces: `POST /api/order/upload-photo` — accepts multipart form-data with one file field named `photo`, returns `{Result: true, path: "images/order_photos/<name>"}` on success or `{Result: false, msg: "..."}` on failure. Task 5's Flutter client calls this once per attached photo.
- Produces (for the test file / internal reuse): `generatePhotoFilename(originalName: string): string` and `buildUploadResponse(file: {filename: string} | undefined): {status: number, body: object}`, both exported from `uploadController.js`.

- [ ] **Step 1: Install multer**

Run: `cd backend && npm install multer --save`
Expected: `package.json`'s `dependencies` gains a `"multer"` entry; `package-lock.json` updates.

- [ ] **Step 2: Write the failing tests**

Create `backend/src/controllers/__tests__/uploadController.test.js`:

```js
const { generatePhotoFilename, buildUploadResponse } = require("../uploadController");

describe("uploadController.generatePhotoFilename", () => {
  it("preserves an allowed image extension", () => {
    const name = generatePhotoFilename("my-package.png");
    expect(name.endsWith(".png")).toBe(true);
  });

  it("falls back to .jpg for a disallowed or missing extension", () => {
    expect(generatePhotoFilename("payload.exe").endsWith(".jpg")).toBe(true);
    expect(generatePhotoFilename("").endsWith(".jpg")).toBe(true);
  });

  it("generates a different name on each call for the same input", () => {
    const a = generatePhotoFilename("photo.jpg");
    const b = generatePhotoFilename("photo.jpg");
    expect(a).not.toBe(b);
  });
});

describe("uploadController.buildUploadResponse", () => {
  it("returns a 400 with no file", () => {
    const { status, body } = buildUploadResponse(undefined);
    expect(status).toBe(400);
    expect(body.Result).toBe(false);
  });

  it("returns the relative order_photos path with a file", () => {
    const { status, body } = buildUploadResponse({ filename: "123_abc.jpg" });
    expect(status).toBe(200);
    expect(body).toEqual({ Result: true, path: "images/order_photos/123_abc.jpg" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx jest uploadController.test.js`
Expected: FAIL with "Cannot find module '../uploadController'".

- [ ] **Step 4: Write the implementation**

Create `backend/src/controllers/uploadController.js`:

```js
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const logger = require("../utils/logger");

const ORDER_PHOTOS_DIR = path.join(__dirname, "..", "..", "public", "images", "order_photos");
fs.mkdirSync(ORDER_PHOTOS_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function generatePhotoFilename(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : ".jpg";
  return `${Date.now()}_${crypto.randomBytes(8).toString("hex")}${safeExt}`;
}

function buildUploadResponse(file) {
  if (!file) {
    return {
      status: 400,
      body: { Result: false, msg: "No image file provided (field name must be 'photo') or file is not an image" },
    };
  }
  return { status: 200, body: { Result: true, path: `images/order_photos/${file.filename}` } };
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ORDER_PHOTOS_DIR),
  filename: (req, file, cb) => cb(null, generatePhotoFilename(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

function uploadOrderPhoto(req, res) {
  upload(req, res, (err) => {
    if (err) {
      logger.error("uploadOrderPhoto failed:", err);
      return res.status(400).json({ Result: false, msg: err.message || "Upload failed" });
    }
    const { status, body } = buildUploadResponse(req.file);
    return res.status(status).json(body);
  });
}

module.exports = { generatePhotoFilename, buildUploadResponse, uploadOrderPhoto, ORDER_PHOTOS_DIR };
```

- [ ] **Step 5: Wire the route**

In `backend/src/routes/orderRoutes.js`, add the controller import and route:

```js
const express = require("express");
const orderController = require("../controllers/orderController");
const uploadController = require("../controllers/uploadController");

const router = express.Router();

router.get("/categories", orderController.getCategories);
router.post("/fare-estimate", orderController.fareEstimate);
router.post("/create", orderController.createOrder);
router.post("/details", orderController.getOrderDetails);
router.post("/customer-cancel", orderController.customerCancel);
router.post("/rate", orderController.rateOrder);
router.post("/upload-photo", uploadController.uploadOrderPhoto);

module.exports = router;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx jest uploadController.test.js`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/controllers/uploadController.js backend/src/controllers/__tests__/uploadController.test.js backend/src/routes/orderRoutes.js
git commit -m "feat(backend): add POST /api/order/upload-photo endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016JdmgRqfr7YZKez3SWHH5N"
```

---

## Task 3: Flutter — NodeSocketManager singleton + connect/disconnect wiring

**Files:**
- Create: `ShifterOnlineFinal/lib/socket/node_socket_manager.dart`
- Modify: `ShifterOnlineFinal/pubspec.yaml` (add `socket_io_client` dependency)
- Modify: `ShifterOnlineFinal/lib/Api/config.dart` (add `nodeBaseUrl` constant)
- Modify: `ShifterOnlineFinal/lib/bottombar.dart` (connect on shell entry)
- Modify: `ShifterOnlineFinal/lib/screens/profile/myprofile.dart` (disconnect on logout)

**Interfaces:**
- Produces: `NodeSocketManager()` (factory singleton) with `.connect(String userId)`, `.joinOrderRoom(String userId, String orderId)`, `.disconnect()`, `.isConnected`, and `.socket` (the raw `IO.Socket?`, for screens to attach their own `on()`/`off()` listeners — used by Tasks 6 and 7).

- [ ] **Step 1: Add the dependency**

In `ShifterOnlineFinal/pubspec.yaml`, add under the `# Network & API` section (after `http_auth: ^1.0.1`):

```yaml
  # Realtime
  socket_io_client: ^3.1.6
```

- [ ] **Step 2: Add the Node base URL constant**

In `ShifterOnlineFinal/lib/Api/config.dart`, add after the `baseurl` line:

```dart
  // Node.js order-flow backend (REST + Socket.io) — same host the driver
  // app's NodeSocketManager.java uses.
  static const String nodeBaseUrl = "https://shifteronline-nodejs.onrender.com";
```

- [ ] **Step 3: Write NodeSocketManager**

Create `ShifterOnlineFinal/lib/socket/node_socket_manager.dart`:

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:goParcel/Api/config.dart';

/// One persistent Socket.io connection to the Node order-flow backend,
/// opened when the customer is logged in (app start if a session exists, or
/// right after login) and closed at logout. Screens attach/detach their own
/// on()/off() listeners directly on [socket] — no separate state-management
/// abstraction, matching the driver app's NodeSocketManager.java pattern.
class NodeSocketManager {
  NodeSocketManager._internal();
  static final NodeSocketManager _instance = NodeSocketManager._internal();
  factory NodeSocketManager() => _instance;

  IO.Socket? _socket;
  String? _userId;

  void connect(String userId) {
    if (userId.isEmpty || userId == "0") return;
    if (_socket != null && _socket!.connected && _userId == userId) {
      return; // already connected for this user
    }
    disconnect();
    _userId = userId;

    _socket = IO.io(
      Config.nodeBaseUrl,
      IO.OptionBuilder()
          .setTransports(['websocket'])
          .enableReconnection()
          .setReconnectionDelay(2000)
          .disableAutoConnect()
          .build(),
    );

    _socket!.onConnect((_) {
      _socket!.emit('customer:join', {'user_id': userId});
    });

    _socket!.connect();
  }

  /// Call right after a successful order creation — the persistent
  /// connection joined at login predates the new order, so it isn't in
  /// `order_<id>` yet and would miss order:status_changed/completed.
  void joinOrderRoom(String userId, String orderId) {
    _socket?.emit('customer:join', {'user_id': userId, 'order_id': orderId});
  }

  void disconnect() {
    _socket?.clearListeners();
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _userId = null;
  }

  bool get isConnected => _socket?.connected ?? false;

  IO.Socket? get socket => _socket;
}
```

- [ ] **Step 4: Wire connect in Bottombar**

In `ShifterOnlineFinal/lib/bottombar.dart`, add the import:

```dart
import 'package:goParcel/socket/node_socket_manager.dart';
```

In `BottombarState.initState()` (currently ends at `getCurrentData(); setState(() {});`), add the connect call:

```dart
  @override
  void initState() {
    super.initState();
    _selectedIndex = widget.tabIndex ?? 0;
    debugPrint("========== _select Index ========= $_selectedIndex");
    isLogin = getdata.read("firstLogin") ?? false;
    pageListApiController.pageListApi();
    getCurrentData();
    final uid = getdata.read("Uid")?.toString() ?? "";
    NodeSocketManager().connect(uid);
    setState(() {});
  }
```

- [ ] **Step 5: Wire disconnect on logout**

In `ShifterOnlineFinal/lib/screens/profile/myprofile.dart`, add the import:

```dart
import 'package:goParcel/socket/node_socket_manager.dart';
```

In the logout `onTap` callback (around line 331-341), add the disconnect call before storage is cleared:

```dart
                                  onTap: () async{
                                    Get.back();
                                    NodeSocketManager().disconnect();
                                    SharedPreferences prefs = await SharedPreferences.getInstance();
                                    prefs.setBool("isDark", false);
                                    setState(() {});
                                    getdata.remove("Uid");
                                    save("firstLogin", false);
                                    getdata.remove("UserLogin");
                                    Get.offAll(SignIn(paymenttype: "onboarding"));
                                  },
```

- [ ] **Step 6: Verify**

Run: `cd ShifterOnlineFinal && "/c/Users/alkvi/AppData/Local/Pub/Cache/bin/fvm.bat" flutter pub get && "/c/Users/alkvi/AppData/Local/Pub/Cache/bin/fvm.bat" flutter analyze`
Expected: `pub get` resolves `socket_io_client` with no version conflicts; `analyze` reports 0 errors (pre-existing warnings elsewhere in the project are fine — do not introduce new ones in the files touched by this task).

- [ ] **Step 7: Commit**

```bash
git add ShifterOnlineFinal/pubspec.yaml ShifterOnlineFinal/pubspec.lock ShifterOnlineFinal/lib/Api/config.dart ShifterOnlineFinal/lib/socket/node_socket_manager.dart ShifterOnlineFinal/lib/bottombar.dart ShifterOnlineFinal/lib/screens/profile/myprofile.dart
git commit -m "feat(customer-app): add NodeSocketManager singleton with login/logout lifecycle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016JdmgRqfr7YZKez3SWHH5N"
```

---

## Task 4: Flutter — Node REST helpers in ApiWrapper

**Files:**
- Modify: `ShifterOnlineFinal/lib/Api/Api_wrapper.dart`

**Interfaces:**
- Produces: `ApiWrapper.nodePost(String path, Map<String, dynamic> body): Future<Map<String, dynamic>>` — always resolves to a `Map` with at least `ResponseCode`/`Result`/`ResponseMsg` keys, never throws. `ApiWrapper.nodeUploadPhoto(String imagePath): Future<Map<String, dynamic>>` — resolves to `{"Result": true, "path": "..."}` or `{"Result": false, "msg": "..."}`. Used by Task 5 (order creation), Task 6 (waiting-screen cancel), Task 7 (tracking-screen cancel).

- [ ] **Step 1: Add the two methods**

In `ShifterOnlineFinal/lib/Api/Api_wrapper.dart`, add these two static methods to the `ApiWrapper` class (after `dataGetLocation`, before the closing `}`):

```dart
  /// POST to the Node backend (not Config.baseurl) with a JSON body. Always
  /// resolves to a Map carrying ResponseCode/Result/ResponseMsg — same shape
  /// Node's own controllers return on success or failure — so call sites
  /// never need a separate error-shape branch.
  static Future<Map<String, dynamic>> nodePost(String path, Map<String, dynamic> body) async {
    try {
      final url = Uri.parse(Config.nodeBaseUrl + path);
      debugPrint("🌐 NODE POST: $url");
      debugPrint("📤 Body: $body");

      final request = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );

      debugPrint("📊 Status Code: ${request.statusCode}");
      final decoded = jsonDecode(request.body);

      if (decoded is Map<String, dynamic>) return decoded;
      return {"ResponseCode": request.statusCode.toString(), "Result": "false", "ResponseMsg": "Unexpected response format"};
    } catch (e) {
      debugPrint("💥 nodePost Exception: $e");
      return {"ResponseCode": "500", "Result": "false", "ResponseMsg": "Network exception: $e"};
    }
  }

  /// Uploads one image to POST /api/order/upload-photo (field name "photo").
  static Future<Map<String, dynamic>> nodeUploadPhoto(String imagePath) async {
    try {
      final uri = Uri.parse('${Config.nodeBaseUrl}/api/order/upload-photo');
      final request = http.MultipartRequest('POST', uri);
      request.files.add(await http.MultipartFile.fromPath('photo', imagePath));

      final streamed = await request.send().timeout(const Duration(seconds: 30));
      final body = await streamed.stream.bytesToString();
      final decoded = jsonDecode(body);

      if (streamed.statusCode == 200 && decoded is Map && decoded['Result'] == true) {
        return {"Result": true, "path": decoded['path']};
      }
      return {"Result": false, "msg": decoded is Map ? (decoded['msg'] ?? 'Upload failed') : 'Upload failed'};
    } catch (e) {
      debugPrint("💥 nodeUploadPhoto Exception: $e");
      return {"Result": false, "msg": "Network exception: $e"};
    }
  }
```

- [ ] **Step 2: Verify**

Run: `cd ShifterOnlineFinal && "/c/Users/alkvi/AppData/Local/Pub/Cache/bin/fvm.bat" flutter analyze lib/Api/Api_wrapper.dart`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ShifterOnlineFinal/lib/Api/Api_wrapper.dart
git commit -m "feat(customer-app): add ApiWrapper.nodePost/nodeUploadPhoto helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016JdmgRqfr7YZKez3SWHH5N"
```

---

## Task 5: Flutter — order creation via Node (pickupdrop.dart)

Immediate/on-demand orders (`selectedBookingType != 2`) switch from the multipart `pks_order.php` call to: upload each photo individually via `ApiWrapper.nodeUploadPhoto`, then `ApiWrapper.nodePost('/api/order/create', ...)`, then join the new order's socket room. Scheduled orders (`selectedBookingType == 2`) keep using the exact existing `pks_order.php` path (see Global Constraints).

**Files:**
- Modify: `ShifterOnlineFinal/lib/screens/home/pickupdrop.dart:5484-5682` (the `orderParcelApi` function)

**Interfaces:**
- Consumes: `ApiWrapper.nodePost`, `ApiWrapper.nodeUploadPhoto` (Task 4), `NodeSocketManager().joinOrderRoom(String, String)` (Task 3).

- [ ] **Step 1: Replace `orderParcelApi` and add the two new private methods**

In `ShifterOnlineFinal/lib/screens/home/pickupdrop.dart`, add the import at the top of the file (alongside the other `goParcel` imports):

```dart
import 'package:goParcel/socket/node_socket_manager.dart';
```

Replace the body of `orderParcelApi(otid)` from the `// ✅ PREPARE DATA WITH FALLBACK VALUES` comment (line 5566) through the end of the function (the closing `});` of `.catchError` at line 5681, and the function's closing `}` at line 5682) with:

```dart
    if (selectedBookingType == 2 && scheduledDateTime != null) {
      // Scheduled orders stay on the legacy PHP endpoint — Node's
      // /api/order/create never persists schedule_date_time for any caller
      // (confirmed in orderController.createOrderCore: the pkg_order.create
      // data object has no schedule_date_time/loading_charge/etc. fields at
      // all), so there is nothing to migrate here yet.
      _submitLegacyScheduledOrder(uid, picupAddress, dropeAddress, deliveryTypeIds, otid);
      return;
    }

    _submitNodeOrder(uid, picupAddress, dropeAddress, deliveryTypeIds, otid);
  }

  //! -------- legacy scheduled-order path (unchanged behavior) ------
  //! `uid` is passed in explicitly — it's a local var inside orderParcelApi,
  //! not a class field, so these sibling methods can't see it otherwise.
  _submitLegacyScheduledOrder(String uid, String picupAddress, String dropeAddress, List<int> deliveryTypeIds, otid) {
    Map<String, dynamic> data = {
      'uid': uid.isNotEmpty ? uid : "0",
      'p_method_id': _payValue?.toString() ?? "0",
      'paddress': picupAddress,
      'daddress': dropeAddress,
      'pmobile': custNumber,
      'dmobile': dropNumber,
      'd_charge': dcharge.toStringAsFixed(2),
      'transaction_id': otid?.toString() ?? "NA_${DateTime.now().millisecondsSinceEpoch}",
      'description': dropnote.text.isNotEmpty ? dropnote.text : "No description provided",
      'distance': totaldistance.toStringAsFixed(2),
      'category': dropdownvalue.isNotEmpty ? dropdownvalue : selectedWheelerName,
      'delivery_type': jsonEncode(deliveryTypeIds),
      'size': imageList.length.toString(),
      "cou_id": cid?.isNotEmpty == true ? cid! : "0",
      "cou_amt": camount?.isNotEmpty == true ? camount! : "0",
      'plat': lat1.toString(),
      'plong': lon1.toString(),
      'dlat': lat2.toString(),
      'dlong': lon2.toString(),
      'extra_mile_charge': exmilecharge.toStringAsFixed(2),
      'total_dcharge': deliveryfees.toStringAsFixed(2),
      'pick_type': paddresstype?.toString() ?? "Other",
      'drop_type': daddresstype?.toString() ?? "Other",
      "pick_name": pname?.isNotEmpty == true ? pname! : "Customer",
      "drop_name": dname?.isNotEmpty == true ? dname! : "Recipient",
      "time_duration": totaltime?.toString() ?? "0",
      "package_cost": packageSize?.isNotEmpty == true ? packageSize! : "0",
      'gst_number': '',
      'booking_type': selectedBookingType.toString(),
      if (selectedBookingType == 2 && scheduledDateTime != null)
        'schedule_date_time': _formatScheduleDateTime(scheduledDateTime!),
      'loading_charge': _getSelectedDeliveryCharge('loading_charge'),
      'unloading_charge': _getSelectedDeliveryCharge('unloading_charge'),
      'service_charge': _getSelectedDeliveryCharge('service_charge'),
      'free_waiting_time': _getSelectedDeliveryCharge('free_waiting_time'),
      'waiting_charge': '0.00',
      'radius_range': _getSelectedDeliveryCharge('per_km_charge'),
      'radius_charge': _selectedKm.toString(),
    };

    debugPrint("🎯 LEGACY ORDER API DATA TO SEND:");
    data.forEach((key, value) => debugPrint("   🔵 $key: $value"));

    ApiWrapper.doImageUpload(endpoint: Config.pksOrder, params: data, imgs: imageList).then((val) {
      debugPrint("🔄 API Response Received");

      if (val != null && val is Map) {
        if (val['ResponseCode'] == "200" && val['Result'] == "true") {
          debugPrint("✅ Order created successfully!");
          save("OrderID", val["order_id"]);
          if (mounted) setState(() => isPaymentLoding = false);
          String bookingType = val["booking_type"]?.toString() ?? "";
          String responseMsg = val["ResponseMsg"] ?? "Package Order Placed Successfully!!!";

          if (bookingType == "1") {
            Get.to(() => WaitingScreen(orderId: val["order_id"].toString()));
            ApiWrapper.showToastMessage(responseMsg);
          } else {
            ApiWrapper.showToastMessage(responseMsg);
            Get.offAll(() => const Bottombar());
          }
        } else {
          if (mounted) setState(() => isPaymentLoding = false);
          String errorMsg = val["ResponseMsg"] ?? "Unknown error occurred";
          ApiWrapper.showToastMessage("Order failed: $errorMsg");
        }
      } else {
        if (mounted) setState(() => isPaymentLoding = false);
        ApiWrapper.showToastMessage("Invalid response from server");
      }
    }).catchError((error) {
      debugPrint("💥 API Call Exception: $error");
      if (mounted) setState(() => isPaymentLoding = false);
      ApiWrapper.showToastMessage("Network error: ${error.toString()}");
    });
  }

  //! -------- new Node order-creation path (immediate/on-demand orders) ------
  Future<void> _submitNodeOrder(String uid, String picupAddress, String dropeAddress, List<int> deliveryTypeIds, otid) async {
    // Upload each attached photo individually — imageList can hold more than
    // one (camera + gallery both push onto it), but the new Node endpoint
    // accepts one file per call. Joined with commas to match the existing
    // pkg_order.photos convention (see backend orderController.test.js:
    // "images/pack_img/a.jpg,images/pack_img/b.jpg").
    List<String> uploadedPaths = [];
    for (final imagePath in imageList) {
      final uploadResult = await ApiWrapper.nodeUploadPhoto(imagePath.toString());
      if (uploadResult['Result'] == true && uploadResult['path'] != null) {
        uploadedPaths.add(uploadResult['path'].toString());
      } else {
        debugPrint("⚠️ Photo upload failed for $imagePath: ${uploadResult['msg']}");
      }
    }

    Map<String, dynamic> orderData = {
      'uid': uid.isNotEmpty ? uid : "0",
      'category': dropdownvalue.isNotEmpty ? dropdownvalue : selectedWheelerName,
      'delivery_type': deliveryTypeIds,
      'booking_type': selectedBookingType.toString(),
      'plat': lat1.toString(),
      'plong': lon1.toString(),
      'paddress': picupAddress,
      'pick_name': pname?.isNotEmpty == true ? pname! : "Customer",
      'pmobile': custNumber,
      'pick_type': paddresstype?.toString() ?? "Other",
      'dlat': lat2.toString(),
      'dlong': lon2.toString(),
      'daddress': dropeAddress,
      'drop_name': dname?.isNotEmpty == true ? dname! : "Recipient",
      'dmobile': dropNumber,
      'drop_type': daddresstype?.toString() ?? "Other",
      'package_weight': packageSize?.isNotEmpty == true ? packageSize! : "0",
      'package_cost': packageSize?.isNotEmpty == true ? packageSize! : "0",
      'description': dropnote.text.isNotEmpty ? dropnote.text : "No description provided",
      'p_method_id': _payValue?.toString() ?? "0",
      'transaction_id': otid?.toString() ?? "NA_${DateTime.now().millisecondsSinceEpoch}",
      'extra_mile_charge': exmilecharge.toStringAsFixed(2),
      'cou_id': cid?.isNotEmpty == true ? cid! : "0",
      'cou_amt': camount?.isNotEmpty == true ? camount! : "0",
      'radius_km': _selectedKm.toString(),
      if (uploadedPaths.isNotEmpty) 'photos': uploadedPaths.join(','),
    };

    debugPrint("🎯 NODE ORDER DATA TO SEND:");
    orderData.forEach((key, value) => debugPrint("   🔵 $key: $value"));

    try {
      final val = await ApiWrapper.nodePost('/api/order/create', orderData);

      if (val['ResponseCode'] == "200" && val['Result'] == "true") {
        debugPrint("✅ Order created successfully via Node!");
        final orderId = val["order_id"].toString();
        final bookingTypeResp = val["booking_type"]?.toString() ?? "";
        save("OrderID", orderId);
        if (mounted) setState(() => isPaymentLoding = false);
        final responseMsg = val["ResponseMsg"] ?? "Package Order Placed Successfully!!!";

        if (bookingTypeResp == "1") {
          NodeSocketManager().joinOrderRoom(uid, orderId);
          ApiWrapper.showToastMessage(responseMsg);
          Get.to(() => WaitingScreen(orderId: orderId));
        } else {
          ApiWrapper.showToastMessage(responseMsg);
          Get.offAll(() => const Bottombar());
        }
      } else {
        debugPrint("❌ Node order creation failed: ${val["ResponseMsg"]}");
        if (mounted) setState(() => isPaymentLoding = false);
        ApiWrapper.showToastMessage("Order failed: ${val["ResponseMsg"] ?? "Unknown error occurred"}");
      }
    } catch (e) {
      debugPrint("💥 Node order API Exception: $e");
      if (mounted) setState(() => isPaymentLoding = false);
      ApiWrapper.showToastMessage("Network error: ${e.toString()}");
    }
  }
```

- [ ] **Step 2: Verify**

Run: `cd ShifterOnlineFinal && "/c/Users/alkvi/AppData/Local/Pub/Cache/bin/fvm.bat" flutter analyze lib/screens/home/pickupdrop.dart`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add ShifterOnlineFinal/lib/screens/home/pickupdrop.dart
git commit -m "feat(customer-app): create immediate orders via Node, keep scheduled orders on legacy path

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016JdmgRqfr7YZKez3SWHH5N"
```

---

## Task 6: Flutter — waiting_screen.dart: socket-driven assignment + Node cancel

Replaces the 8-second `check_driver.php` polling loop (and its `time_out`-driven auto-close countdown, which has no Node equivalent) with `order:assigned`/`order:no_driver_found` socket listeners. Swaps cancel to Node.

**Files:**
- Modify: `ShifterOnlineFinal/lib/screens/home/waiting_screen.dart` (full-file rewrite of the state class body — the widget's `build()` method is unchanged except for removing the "Auto-closing in" countdown block)

**Interfaces:**
- Consumes: `NodeSocketManager().socket` (Task 3), `ApiWrapper.nodePost` (Task 4).

- [ ] **Step 1: Replace the file**

Replace `ShifterOnlineFinal/lib/screens/home/waiting_screen.dart` in full with:

```dart
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/socket/node_socket_manager.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:lottie/lottie.dart';

class WaitingScreen extends StatefulWidget {
  final String orderId;
  const WaitingScreen({Key? key, required this.orderId}) : super(key: key);

  @override
  State<WaitingScreen> createState() => _WaitingScreenState();
}

class _WaitingScreenState extends State<WaitingScreen> {
  bool _isDisposed = false;
  bool _isCancelling = false;

  void _onOrderAssigned(dynamic data) {
    if (_isDisposed) return;
    final eventOrderId = data is Map ? data['order_id']?.toString() : null;
    if (eventOrderId != widget.orderId) return;
    debugPrint("✅ order:assigned received for order ${widget.orderId} — navigating to TrackingWay");
    Get.off(() => const TrackingWay(type: "Pickup"));
  }

  void _onNoDriverFound(dynamic data) {
    if (_isDisposed) return;
    final eventOrderId = data is Map ? data['order_id']?.toString() : null;
    if (eventOrderId != widget.orderId) return;
    debugPrint("❌ order:no_driver_found received for order ${widget.orderId}");
    ApiWrapper.showToastMessage("No delivery partner found nearby. Please try again.".tr);
    Get.back();
  }

  @override
  void initState() {
    super.initState();
    NodeSocketManager().socket?.on('order:assigned', _onOrderAssigned);
    NodeSocketManager().socket?.on('order:no_driver_found', _onNoDriverFound);
  }

  @override
  void dispose() {
    _isDisposed = true;
    NodeSocketManager().socket?.off('order:assigned', _onOrderAssigned);
    NodeSocketManager().socket?.off('order:no_driver_found', _onNoDriverFound);
    super.dispose();
  }

  void pksCancleOrder({String? comment}) async {
    if (_isCancelling) return;
    setState(() {
      _isCancelling = true;
    });

    var uid = getdata.read("Uid") ?? "";
    var orderid = widget.orderId.isNotEmpty ? widget.orderId : (getdata.read("OrderID") ?? "0").toString();

    var data = {
      "uid": uid,
      "order_id": orderid,
      "comment": comment ?? "Cancelled by user during search",
    };

    debugPrint("🚫 Cancelling order via Node customer-cancel: $data");

    try {
      var val = await ApiWrapper.nodePost('/api/order/customer-cancel', data);
      if (val['ResponseCode'] == "200" && val['Result'] == "true") {
        ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Order Cancelled Successfully".tr);
        Get.offAll(() => const Bottombar());
        return;
      } else {
        ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Failed to cancel order".tr);
      }
    } catch (e) {
      debugPrint("❌ Cancel Order Exception: $e");
      ApiWrapper.showToastMessage("Error cancelling order".tr);
    } finally {
      if (!_isDisposed && mounted) {
        setState(() {
          _isCancelling = false;
        });
      }
    }
  }

  void _showCancelDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Text(
            "Cancel Order?".tr,
            style: const TextStyle(fontFamily: 'Gilroy_Bold'),
          ),
          content: Text(
            "Are you sure you want to cancel this order?".tr,
            style: const TextStyle(fontFamily: 'Gilroy_Medium'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(
                "No".tr,
                style: const TextStyle(color: Colors.grey, fontFamily: 'Gilroy_Bold'),
              ),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onPressed: () {
                Navigator.pop(context);
                pksCancleOrder(comment: "Cancelled by user during driver search");
              },
              child: Text(
                "Yes, Cancel".tr,
                style: const TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold'),
              ),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              linercolor.withOpacity(0.7),
              linercolor,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
                child: Row(
                  children: [
                    const SizedBox(height: 40),
                  ],
                ),
              ),
              Expanded(
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(20),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.15),
                            shape: BoxShape.circle,
                          ),
                          child: Lottie.asset(
                            'assets/pickup&drop.json',
                            height: 180,
                            errorBuilder: (context, error, stackTrace) {
                              return SizedBox(
                                height: 150,
                                child: Center(
                                  child: CircularProgressIndicator(color: Colors.white),
                                ),
                              );
                            },
                          ),
                        ),
                        const SizedBox(height: 25),
                        Text(
                          "Finding Your Driver...".tr,
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 26,
                            color: Colors.white,
                            letterSpacing: 0.5,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          "Please wait while we connect you with the nearest available delivery partner.".tr,
                          style: const TextStyle(
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 16,
                            color: Colors.white70,
                            height: 1.4,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 25),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(30),
                            border: Border.all(color: Colors.white.withOpacity(0.4)),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.05),
                                blurRadius: 10,
                                offset: const Offset(0, 5),
                              ),
                            ],
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.receipt_long, color: Colors.white, size: 22),
                              const SizedBox(width: 10),
                              Text(
                                "Order ID: #${widget.orderId}",
                                style: const TextStyle(
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 16,
                                  color: Colors.white,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 30),
                        SizedBox(
                          width: double.infinity,
                          height: 50,
                          child: ElevatedButton(
                            onPressed: _isCancelling ? null : _showCancelDialog,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.white.withOpacity(0.2),
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(30),
                                side: BorderSide(color: Colors.white.withOpacity(0.5), width: 1.5),
                              ),
                            ),
                            child: _isCancelling
                                ? const SizedBox(
                                    height: 24,
                                    width: 24,
                                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                                  )
                                : Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      const Icon(Icons.cancel_outlined, color: Colors.white, size: 22),
                                      const SizedBox(width: 8),
                                      Text(
                                        "Cancel Order".tr,
                                        style: const TextStyle(
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 16,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ],
                                  ),
                          ),
                        ),
                        const SizedBox(height: 30),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Verify**

Run: `cd ShifterOnlineFinal && "/c/Users/alkvi/AppData/Local/Pub/Cache/bin/fvm.bat" flutter analyze lib/screens/home/waiting_screen.dart`
Expected: 0 errors, 0 warnings (this is a full-file rewrite, so the pre-existing unused-import warnings this file had should also be gone).

- [ ] **Step 3: Commit**

```bash
git add ShifterOnlineFinal/lib/screens/home/waiting_screen.dart
git commit -m "feat(customer-app): replace driver-assignment polling with socket listeners

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016JdmgRqfr7YZKez3SWHH5N"
```

---

## Task 7: Flutter — trackingway.dart: socket-driven status refresh + Node cancel

Adds `order:status_changed`/`order:completed` listeners that re-trigger the screen's existing `pkgOrder()` + `mapinfo()` REST refresh (no polling loop existed here before — this is new reactive behavior, not a replacement of one). Swaps cancel to Node.

**Files:**
- Modify: `ShifterOnlineFinal/lib/screens/myorder/trackingway.dart:1-142` (imports, state fields, `initState`, `dispose`)
- Modify: `ShifterOnlineFinal/lib/screens/myorder/trackingway.dart:2322-2339` (`pksCancleOrder`)

**Interfaces:**
- Consumes: `NodeSocketManager().socket` (Task 3), `ApiWrapper.nodePost` (Task 4).

- [ ] **Step 1: Add the import**

In `ShifterOnlineFinal/lib/screens/myorder/trackingway.dart`, add alongside the other `goParcel` imports (near line 27):

```dart
import 'package:goParcel/socket/node_socket_manager.dart';
```

- [ ] **Step 2: Add listener methods and wire initState/dispose**

Three separate edits, all within the `_TrackingWayState` class:

**2a.** Replace the `dispose()` method (lines 72-78) in place with:

```dart
  @override
  void dispose() {
    if (widget.type == "Pickup") {
      NodeSocketManager().socket?.off('order:status_changed', _onOrderStatusChanged);
      NodeSocketManager().socket?.off('order:completed', _onOrderCompleted);
    }
    _advanceTimer?.cancel();
    commit.dispose();
    numController.dispose();
    super.dispose();
  }
```

**2b.** Insert these two new methods immediately after line 100 (`RazorPayClass razorPayClass = RazorPayClass();`) and its following comment-divider line 101 — i.e. right before the existing `@override` on line 102 that starts `initState()`:

```dart
  void _onOrderStatusChanged(dynamic data) {
    final eventOrderId = data is Map ? data['order_id']?.toString() : null;
    if (eventOrderId != orderid) return;
    debugPrint("🔄 order:status_changed received for order $orderid — refreshing");
    pkgOrder();
    mapinfo();
  }

  void _onOrderCompleted(dynamic data) {
    final eventOrderId = data is Map ? data['order_id']?.toString() : null;
    if (eventOrderId != orderid) return;
    debugPrint("✅ order:completed received for order $orderid — refreshing");
    pkgOrder();
    mapinfo();
  }
```

**2c.** Replace the `initState()` method (lines 102-114) in place with:

```dart
  @override
  void initState() {
    super.initState();
    uid = widget.uid0 ?? getdata.read("Uid") ?? "";
    orderid = (getdata.read("OrderID") ?? "0").toString();
    paymenrgatway();
    razorPayClass.initiateRazorPay(
      handlePaymentSuccess: handlePaymentSuccess,
      handlePaymentError: handlePaymentError,
      handleExternalWallet: handleExternalWallet,
    );
    pageRefresh();
    if (widget.type == "Pickup") {
      NodeSocketManager().socket?.on('order:status_changed', _onOrderStatusChanged);
      NodeSocketManager().socket?.on('order:completed', _onOrderCompleted);
    }
  }
```

The net result, in file order: `dispose()` (modified) → `_formatTimerText()` (unchanged) → the misc field declarations (unchanged) → `_onOrderStatusChanged` / `_onOrderCompleted` (new) → `initState()` (modified).

- [ ] **Step 3: Swap cancel to Node**

Replace `pksCancleOrder` (lines 2322-2339) with:

```dart
  pksCancleOrder({String? comment}) async {
    var uid = getdata.read("Uid") ?? "";
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {
      "uid": uid,
      "order_id": orderid,
      "comment": comment ?? "",
    };
    final val = await ApiWrapper.nodePost('/api/order/customer-cancel', data);
    if (val['ResponseCode'] == "200" && val['Result'] == "true") {
      log(val.toString(), name: "customer-cancel");
      Get.off(() => Bottombar());
      ApiWrapper.showToastMessage(val["ResponseMsg"]);
    }
  }
```

- [ ] **Step 4: Verify**

Run: `cd ShifterOnlineFinal && "/c/Users/alkvi/AppData/Local/Pub/Cache/bin/fvm.bat" flutter analyze lib/screens/myorder/trackingway.dart`
Expected: 0 new errors (this file has pre-existing warnings unrelated to this change — e.g. deprecated `withOpacity` calls elsewhere in the file — those are out of scope and should remain unchanged).

- [ ] **Step 5: Commit**

```bash
git add ShifterOnlineFinal/lib/screens/myorder/trackingway.dart
git commit -m "feat(customer-app): add socket-driven status refresh, swap cancel to Node

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016JdmgRqfr7YZKez3SWHH5N"
```

---

## Task 8: Manual end-to-end verification

**Files:** None (verification only).

- [ ] **Step 1: Build a debug APK**

Run: `cd ShifterOnlineFinal && "/c/Users/alkvi/AppData/Local/Pub/Cache/bin/fvm.bat" flutter build apk --debug`
Expected: `Built build\app\outputs\flutter-apk\app-debug.apk` with no errors.

- [ ] **Step 2: Install on the physical device and sign in**

Install `build/app/outputs/flutter-apk/app-debug.apk` on the user's test device, sign in with a test customer account. Confirm (via backend logs or a Prisma query against `pkg_order`/socket connection logs) that the Node socket connects and emits `customer:join` on reaching the main app shell.

- [ ] **Step 3: Create an immediate order with a photo, verify assignment**

From the app: create a new immediate (non-scheduled) order with at least one package photo attached, using the same test-driver account(s) used throughout the driver-app SDD work. Confirm:
- The photo upload succeeds (check `backend/public/images/order_photos/` for the new file, and `pkg_order.photos` in the DB for the stored path).
- The waiting screen transitions to the tracking screen via the `order:assigned` socket event (not a poll) once the test driver accepts.
- If no driver accepts in time, confirm the `order:no_driver_found` path shows the toast and returns to the previous screen.

- [ ] **Step 4: Verify status progression and completion**

Progress the test order through arrived → pickup → arrived-drop → complete on the driver app (per the existing driver-app flow). On the customer app's tracking screen, confirm each status change appears without the user manually pulling to refresh (driven by `order:status_changed`/`order:completed`).

- [ ] **Step 5: Verify cancel**

Cancel an order from both the waiting screen and the tracking screen (two separate test orders) and confirm each cancellation succeeds via Node (`pkg_order.o_status` becomes `Cancelled` in the DB) and the UI navigates back to the main shell.

- [ ] **Step 6: Verify the scheduled-order path is untouched**

Create one scheduled order (`booking_type == 2`) and confirm it still submits successfully via the legacy `pks_order.php` path (no regression from this plan).

No commit for this task — if any step surfaces a bug, fix it in the relevant task's file, re-run that task's verification step, and commit the fix with a message describing what live testing caught (matching the driver-app plan's precedent for Tasks 7/8).
