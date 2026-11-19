import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/screens/home/home.dart';
import 'package:goParcel/screens/home/trackingpoliyline.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/utils/booking_guarantee.dart';
import 'package:goParcel/utils/node_socket_manager.dart';
import 'package:goParcel/utils/scheduled_order_watch.dart';
import 'package:flutter/services.dart';
import 'package:goParcel/screens/home/search_progress.dart';
import 'package:goParcel/screens/home/widgets/finding_driver_widgets.dart';
import 'package:goParcel/screens/home/widgets/search_map.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:goParcel/theme/app_tokens.dart';

class WaitingScreen extends StatefulWidget {
  final String orderId;

  /// Name of the vehicle the customer booked (e.g. "3 wheeler"); drives the animation. When it is not passed
  /// (app reopened on this screen) it is restored from the saved value or the order itself.
  final String? vehicleName;
  /// True when the customer booked the last available model, false for an earlier one, null if unknown.
  final bool? lastModelSelected;
  const WaitingScreen({Key? key, required this.orderId, this.vehicleName, this.lastModelSelected}) : super(key: key);

  @override
  State<WaitingScreen> createState() => _WaitingScreenState();
}

class _WaitingScreenState extends State<WaitingScreen> {
  static const _waitingOrderKey = 'active_waiting_order_id';
  static const _waitingExpiryKey = 'active_waiting_expires_at';
  static const _waitingVehicleKey = 'active_waiting_vehicle';
  static const _waitingLastModelKey = 'active_waiting_last_model';
  String _vehicleName = '';
  bool? _lastModelSelected;
  Timer? _timer;
  Timer? _timeoutTimer;
  Timer? _countdownTicker;
  bool _isDisposed = false;
  bool _timeoutSet = false;
  bool _isCancelling = false;
  bool _handedOffToTracking = false;
  bool _recoveringOrder = false;
  double _guaranteeAmount = 0;
  bool _guaranteePending = false;
  // Booking Guarantee state for the line under the timer: 'on' | 'locked' (referrals pending) | 'off'.
  String _searchGuarantee = 'off';
  int _referralsNeeded = 0;
  // The moment the on-screen countdown reaches 0 (driver search time + admin arrangement time, from the city's settings).
  DateTime? _timerDeadline;
  NodeSocketSubscription? _socketSubscription;
  // Progress display (no countdown): the search window runs from the order time to the REAL search deadline
  // (System 2 window / guarantee wait) — never the 130 s safety timer. Until that is known, time on this
  // screen over a nominal window is used. The bar never moves backwards.
  final SearchProgressTracker _progress = SearchProgressTracker(screenOpenedAt: DateTime.now());
  // Trip card, from the order-details response this screen already fetches.
  String? _tripFare;
  String? _tripPickup;
  String? _tripDrop;
  // Map: pickup and drop coordinates from the same order-details response.
  LatLng? _tripPickupLatLng;
  LatLng? _tripDropLatLng;

  static void clearPersistedWaitingOrder() {
    getdata.remove(_waitingOrderKey);
    getdata.remove(_waitingExpiryKey);
    getdata.remove(_waitingVehicleKey);
    getdata.remove(_waitingLastModelKey);
  }

  void _persistWaitingOrder(int expiresAt) {
    getdata.write(_waitingOrderKey, widget.orderId);
    getdata.write(_waitingExpiryKey, expiresAt);
    if (_vehicleName.isNotEmpty) getdata.write(_waitingVehicleKey, _vehicleName);
    if (_lastModelSelected != null) getdata.write(_waitingLastModelKey, _lastModelSelected);
  }

  void _navigateBackToHome() {
    // Register order with ScheduledOrderWatch so Bottombar listens for assignment in background
    ScheduledOrderWatch.add(widget.orderId);
    ApiWrapper.showToastMessage("Order #${widget.orderId} is active in background.".tr);
    Get.offAll(() => const Bottombar(tabIndex: 0));
  }

  void pksCancleOrder({String? comment}) async {
    if (_isCancelling) return;
    setState(() {
      _isCancelling = true;
    });

    var uid = getdata.read("Uid") ?? "";
    var orderid = widget.orderId.isNotEmpty ? widget.orderId : (getdata.read("OrderID") ?? "0").toString();

    var data = {
      "uid": int.tryParse(uid.toString()) ?? 0,
      "order_id": int.tryParse(orderid.toString()) ?? 0,
      "comment": comment ?? "Cancelled by user during search",
    };

    debugPrint("🚫 Cancelling order via Node customer-cancel: $data");

    try {
      var val = await ApiWrapper.dataPostNode(Config.nodeOrderCancel, data);
      if (val != null && val is Map) {
        if (val['ResponseCode'] == "200" && val['Result'] == "true") {
          clearPersistedWaitingOrder();
          _timer?.cancel();
          _timeoutTimer?.cancel();
          _countdownTicker?.cancel();

          ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Order Cancelled Successfully".tr);
          Get.offAll(() => const Bottombar());
          return;
        } else {
          ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Failed to cancel order".tr);
        }
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
    final p = AppPalette.current;
    showDialog(
      context: context,
      builder: (context) {
        return Dialog(
          backgroundColor: p.surface,
          insetPadding: const EdgeInsets.symmetric(horizontal: 22),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 22, 20, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(color: p.dangerTint, shape: BoxShape.circle),
                    child: Icon(Icons.campaign_rounded, color: p.danger, size: 28),
                  ),
                ),
                const SizedBox(height: 12),
                Center(
                  child: Text("Cancel Order?".tr, style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 21, color: p.ink)),
                ),
                const SizedBox(height: 4),
                Center(
                  child: Text(
                    "Wait! You Could Still Get Extra Benefits!".tr,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14.5, color: p.brandText),
                  ),
                ),
                const SizedBox(height: 14),
                Text("If you wait a little longer, you may get:".tr,
                    style: TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 14, color: p.inkMuted)),
                const SizedBox(height: 10),
                _cancelBenefit(
                  icon: Icons.currency_rupee_rounded,
                  color: p.successText,
                  background: p.successTint,
                  title: "100% Booking Refund".tr,
                  body: "Your booking may be confirmed with a full refund.".tr,
                ),
                const SizedBox(height: 10),
                _cancelBenefit(
                  icon: Icons.verified_user_rounded,
                  color: p.brandText,
                  background: p.brandTint,
                  title: "Get Compensation Benefit".tr,
                  body: "Don't lose chance for compensation benefit.".tr,
                ),
                const SizedBox(height: 16),
                Text("Do you still want to cancel this order?".tr,
                    style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14, color: p.ink)),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: p.brand,
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        onPressed: () => Navigator.pop(context),
                        child: Text("No, Keep Booking".tr,
                            textAlign: TextAlign.center,
                            style: TextStyle(color: p.onBrand, fontFamily: 'Gilroy_Bold', fontSize: 14)),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: p.danger,
                          side: BorderSide(color: p.danger.withOpacity(0.5)),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        onPressed: () {
                          Navigator.pop(context);
                          pksCancleOrder(comment: "Cancelled by user during driver search");
                        },
                        child: Text("Yes, Cancel".tr,
                            style: TextStyle(color: p.danger, fontFamily: 'Gilroy_Bold', fontSize: 14)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _cancelBenefit({
    required IconData icon,
    required Color color,
    required Color background,
    required String title,
    required String body,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14.5, color: color)),
                const SizedBox(height: 2),
                Text(body, style: TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 12.5, color: AppPalette.current.inkMuted)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Node's dispatch cascade can legitimately take a couple of minutes in the
  // worst case (5 models × up to 2 tries each, ~15-18s apart — see
  // backend/src/services/dispatchManager.js's staleLaps termination), so
  // this is a generous safety net, not the expected case — normally
  // order:assigned or order:no_driver_found arrives well before this.
  static const int _safetyTimeoutSeconds = 130;

  @override
  void initState() {
    super.initState();
    NodeSocketManager.instance.connectionState.addListener(_recoverAfterReconnect);
    _listenForAssignment();
    final savedOrderId = getdata.read(_waitingOrderKey)?.toString();
    _vehicleName = (widget.vehicleName ?? (savedOrderId == widget.orderId ? getdata.read(_waitingVehicleKey)?.toString() : null) ?? '').trim();
    final savedLastModel = savedOrderId == widget.orderId ? getdata.read(_waitingLastModelKey) : null;
    _lastModelSelected = widget.lastModelSelected ?? (savedLastModel is bool ? savedLastModel : null);
    final savedExpiry = int.tryParse(getdata.read(_waitingExpiryKey)?.toString() ?? '');
    final now = DateTime.now().millisecondsSinceEpoch;
    final hasValidSavedTimer = savedOrderId == widget.orderId &&
        savedExpiry != null && savedExpiry > now;
    final expiry = hasValidSavedTimer
        ? savedExpiry
        : now + (_safetyTimeoutSeconds * 1000);
    final remaining = ((expiry - now) / 1000).ceil();
    _persistWaitingOrder(expiry);
    _startTimeout(remaining);
    // Learn the real search window (System 2) as soon as the screen opens.
    WidgetsBinding.instance.addPostFrameCallback((_) => _recoverActiveOrder());
  }

  @override
  void dispose() {
    _isDisposed = true;
    _timer?.cancel();
    _timeoutTimer?.cancel();
    _countdownTicker?.cancel();
    _socketSubscription?.dispose();
    NodeSocketManager.instance.connectionState.removeListener(_recoverAfterReconnect);
    super.dispose();
  }

  void _recoverAfterReconnect() {
    if (_isDisposed || NodeSocketManager.instance.connectionState.value != SocketConnectionState.connected) {
      return;
    }
    _recoverActiveOrder();
  }

  Future<void> _recoverActiveOrder() async {
    final uid = getdata.read("Uid");
    if (uid == null || _handedOffToTracking || _recoveringOrder) return;
    _recoveringOrder = true;

    try {
      final value = await ApiWrapper.dataPostNode(Config.nodeOrderDetails, {
        "uid": int.tryParse(uid.toString()) ?? 0,
        "order_id": int.tryParse(widget.orderId) ?? 0,
      });
      if (_isDisposed || value is! Map || (value['Result'] != "true" && value['Result'] != true)) return;

      final list = value['OrderProductList'];
      final order = list is List && list.isNotEmpty && list.first is Map
          ? Map<String, dynamic>.from(list.first)
          : null;
      if (order == null) return;

      _captureTripInfo(order);

      // The order knows its vehicle, so the animation is right even if this screen was reopened cold.
      final orderVehicle = (order['category'] ?? '').toString().trim();
      if (orderVehicle.isNotEmpty && orderVehicle != _vehicleName && mounted) {
        setState(() => _vehicleName = orderVehicle);
        getdata.write(_waitingVehicleKey, orderVehicle);
      }

      final flow = int.tryParse((order['order_status'] ?? order['Order_flow_id'] ?? '').toString());
      final riderId = int.tryParse((order['rid'] ?? order['rider_id'] ?? '').toString()) ?? 0;
      final guarantee = order['guarantee'];
      final g = guarantee is Map ? Map<String, dynamic>.from(guarantee) : null;
      final search = order['search'];
      if (search is Map) _applySearchWindow(Map<String, dynamic>.from(search));
      if (g != null) {
        final amount = parseGuaranteeAmount(g['amount']);
        if (g['state'] == 'pending') {
          _enterGuaranteeWait(amount, deadline: DateTime.tryParse(g['deadline_at']?.toString() ?? ''));
          return;
        }
        if (mounted && amount != _guaranteeAmount) setState(() => _guaranteeAmount = amount);
      }
      if (riderId > 0 || (flow != null && flow >= 1 && flow <= 3)) {
        _handedOffToTracking = true;
        clearPersistedWaitingOrder();
        Get.off(() => TrackingWay(type: "Pickup", initialOrderData: order));
      } else if (flow == 4) {
        clearPersistedWaitingOrder();
        final paid = g != null && g['state'] == 'paid' ? parseGuaranteeAmount(g['amount']) : 0.0;
        ApiWrapper.showToastMessage(noDriverMessage(paid, lastModel: _lastModelSelected).tr);
        Get.offAll(() => const Bottombar());
      }
    } finally {
      _recoveringOrder = false;
    }
  }

  /// Order time, fare and addresses for the progress bar and the trip card. Missing values stay null (hidden).
  void _captureTripInfo(Map<String, dynamic> order) {
    String? text(Object? v) {
      final s = v?.toString().trim() ?? '';
      return s.isEmpty || s == 'null' ? null : s;
    }

    final orderedAt = DateTime.tryParse(text(order['order_date']) ?? '');
    final total = text(order['grand_total']);
    if (!mounted) return;
    setState(() {
      // An order time in the future (clock skew) would freeze the bar; fall back to time on screen.
      _progress.orderedAt = orderedAt != null && !orderedAt.isAfter(DateTime.now()) ? orderedAt : null;
      _tripFare = total == null ? null : '₹$total';
      _tripPickup = text(order['customer_paddress']);
      _tripDrop = text(order['customer_daddress']);
      final pLat = double.tryParse(text(order['plat']) ?? ''), pLng = double.tryParse(text(order['plong']) ?? '');
      final dLat = double.tryParse(text(order['dlat']) ?? ''), dLng = double.tryParse(text(order['dlong']) ?? '');
      final pick = pLat != null && pLng != null ? LatLng(pLat, pLng) : null;
      final drop = dLat != null && dLng != null ? LatLng(dLat, dLng) : null;
      // Keep the same instances when nothing moved, so the map is not refitted on every recovery.
      if (pick != _tripPickupLatLng) _tripPickupLatLng = pick;
      if (drop != _tripDropLatLng) _tripDropLatLng = drop;
    });
  }

  void _listenForAssignment() {
    // Make sure this socket connection is actually in this order's room —
    // matters if the app was backgrounded/reconnected between order
    // creation and reaching this screen.
    NodeSocketManager.instance.joinOrder(widget.orderId);

    _socketSubscription = NodeSocketManager.instance.addListeners(onOrderAssigned: (data) {
      if (_isDisposed) return;
      if (data['order_id']?.toString() != widget.orderId) return; // a stale/other order's event
      debugPrint("✅ order:assigned received: $data");
      _timeoutTimer?.cancel();
      _countdownTicker?.cancel();
      _handedOffToTracking = true;
      clearPersistedWaitingOrder();
      if (data['free_booking'] is Map && (data['free_booking']['is_free'] == true || data['free_booking']['is_free'] == 'true')) {
        ApiWrapper.showToastMessage("Free Ride Chance Won! Full fare will be credited to your wallet upon completion.".tr);
      }
      // The assignment event is the first authoritative place where the
      // advance amount is available. Pass it forward so payment can render
      // immediately; TrackingWay still refreshes full details in parallel.
      Get.off(() => TrackingWay(type: "Pickup", initialOrderData: data));
    }, onNoDriverFound: (data) {

      if (_isDisposed) return;
      if (data['order_id']?.toString() != widget.orderId) return;
      debugPrint("❌ order:no_driver_found received: $data");
      clearPersistedWaitingOrder();
      _timeoutTimer?.cancel();
      _countdownTicker?.cancel();
      final notAvailable = data['reason']?.toString() == 'driver_not_available';
      ApiWrapper.showToastMessage(
        (notAvailable ? driverNotAvailableMessage : noDriverMessage(parseGuaranteeAmount(data['compensation_amount']), lastModel: _lastModelSelected)).tr,
      );
      Get.offAll(() => const Bottombar());
    }, onGuaranteePending: (data) {
      if (data['order_id']?.toString() != widget.orderId) return;
      _enterGuaranteeWait(parseGuaranteeAmount(data['amount']), deadline: DateTime.tryParse(data['deadline_at']?.toString() ?? ''));
    });
  }

  /// The order is being held for an admin to assign a driver (Booking Guarantee). The 130 s safety timer
  /// would otherwise dump the customer on Home while their order is still alive, so stop it.
  void _enterGuaranteeWait(double amount, {DateTime? deadline}) {
    if (_isDisposed) return;
    _timeoutTimer?.cancel();
    clearPersistedWaitingOrder();
    setState(() {
      _guaranteePending = true;
      _guaranteeAmount = amount;
    });
    if (deadline != null) _progress.searchDeadline = deadline;
    _startCountdown(deadline ?? _timerDeadline);
  }

  // Extra seconds past the search deadline before the safety timer gives up, so the server's own
  // guarantee / "Driver is not available" event always arrives first.
  static const int _searchGraceSeconds = 30;

  /// Replace the fixed 130 s safety timer with the order's real window: driver search time + admin
  /// arrangement time, both set per city in the Admin Panel. Also learns the guarantee eligibility state.
  void _applySearchWindow(Map<String, dynamic> search) {
    if (_isDisposed) return;
    final guarantee = search['guarantee']?.toString() ?? 'off';
    final needed = int.tryParse(search['referrals_needed']?.toString() ?? '') ?? 0;
    if (mounted && (guarantee != _searchGuarantee || needed != _referralsNeeded)) {
      setState(() {
        _searchGuarantee = guarantee;
        _referralsNeeded = needed;
      });
    }
    if (_guaranteePending || search['system']?.toString() != '2') return;
    final deadline = DateTime.tryParse(search['total_deadline_at']?.toString() ?? '') ??
        DateTime.tryParse(search['deadline_at']?.toString() ?? '');
    if (deadline == null) return;
    final seconds = deadline.difference(DateTime.now()).inSeconds + _searchGraceSeconds;
    if (seconds <= 0) return;
    _progress.searchDeadline = deadline;
    _timeoutTimer?.cancel();
    _countdownTicker?.cancel();
    _timeoutSet = false;
    _persistWaitingOrder(DateTime.now().millisecondsSinceEpoch + seconds * 1000);
    _startTimeout(seconds, displayDeadline: deadline);
  }

  /// Refreshes the progress display once a second; [deadline] is the end of the search window.
  void _startCountdown(DateTime? deadline) {
    if (deadline != null) _timerDeadline = deadline;
    _countdownTicker?.cancel();
    if (mounted) setState(() {});
    _countdownTicker = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_isDisposed) { t.cancel(); return; }
      setState(() {});
    });
  }

  /// The Booking Guarantee card: the compensation amount, the referral condition still pending, or
  /// "no compensation" — all from backend data. In the [late] stage an active guarantee leads with
  /// "You are covered".
  Widget _buildGuaranteeCard({bool late = false}) {
    final p = AppPalette.current;
    final IconData icon;
    final Color tone;
    final Color background;
    final List<Widget> lines;
    final bold = AppText.bodyStrong(p.ink).copyWith(fontSize: 14.5);
    final soft = AppText.caption(p.inkMuted).copyWith(fontSize: 12.5);
    if (_searchGuarantee == 'locked') {
      icon = Icons.hourglass_bottom_rounded;
      tone = p.warning;
      background = p.warningTint;
      final n = _referralsNeeded > 0 ? _referralsNeeded : 1;
      lines = [
        Text("Complete required referrals to unlock compensation benefit.".tr, style: bold),
        const SizedBox(height: 2),
        Text(n == 1 ? "You need 1 more referral to be eligible.".tr : "You need $n more referrals to be eligible.".tr, style: soft),
      ];
    } else if (_guaranteeAmount > 0) {
      icon = Icons.verified_user_rounded;
      tone = p.successText;
      background = p.successTint;
      lines = [
        if (late) ...[
          Text("You are covered".tr, style: bold.copyWith(fontSize: 16)),
          const SizedBox(height: 2),
          Text("If we can't find a driver, you will receive compensation of".tr, style: soft),
        ] else
          Text("If we can't find a driver, you will receive compensation of".tr, style: bold),
        Text(rupeesText(_guaranteeAmount), style: bold.copyWith(color: p.successText, fontSize: 16)),
      ];
    } else {
      icon = Icons.info_outline_rounded;
      tone = p.inkMuted;
      background = p.surface;
      lines = [
        Text("If we can't find a driver, no compensation is available for this booking.".tr, style: bold),
      ];
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(color: tone.withValues(alpha: 0.14), shape: BoxShape.circle),
            child: Icon(icon, color: tone, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: lines)),
        ],
      ),
    );
  }

  /// Auto-close safety net — normally superseded by a socket event above.
  void _startTimeout(int seconds, {DateTime? displayDeadline}) {
    if (_timeoutSet || seconds <= 0) return;
    _timeoutSet = true;

    _startCountdown(displayDeadline ?? DateTime.now().add(Duration(seconds: seconds)));

    _timeoutTimer = Timer(Duration(seconds: seconds), () {
      if (!_isDisposed) {
        debugPrint("⏰ Safety timeout reached — closing waiting screen");
        _countdownTicker?.cancel();
        clearPersistedWaitingOrder();
        Get.offAll(() => const Bottombar());
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final isDark = AppPalette.current == AppPalette.dark;
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final f = _progress.fractionAt(DateTime.now());
    final stage = searchStage(f);
    Widget rise(int i, Widget child) =>
        reduceMotion ? child : _RiseIn(delay: Duration(milliseconds: 150 + 120 * i), child: child);

    return WillPopScope(
      onWillPop: () async {
        _navigateBackToHome();
        return false;
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: (isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
            .copyWith(statusBarColor: Colors.transparent),
        child: Scaffold(
          backgroundColor: p.canvas,
          body: Column(
            children: [
              // Header, like Porter's trip screen: back · Order #id · Home.
              Material(
                color: p.surface,
                child: SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
                    child: Row(
                      children: [
                        IconButton(
                          onPressed: _navigateBackToHome,
                          tooltip: 'Back'.tr,
                          icon: Icon(Icons.arrow_back_rounded, color: p.ink),
                        ),
                        Expanded(
                          child: Text(
                            '${'Order'.tr} #${widget.orderId}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.section(p.ink),
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _navigateBackToHome,
                          icon: Icon(Icons.home_outlined, size: 18, color: p.brandText),
                          label: Text("Go to Home".tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 14)),
                          style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SocketStatusBanner(),
              Expanded(
                child: LayoutBuilder(builder: (context, box) {
                  const sheetMin = 0.46;
                  return Stack(
                    children: [
                      // Map with the curved pickup → drop route; built once (RepaintBoundary keeps the
                      // per-second sheet refresh from touching it).
                      Positioned.fill(
                        child: RepaintBoundary(
                          child: SearchRouteMap(
                            pickup: _tripPickupLatLng,
                            drop: _tripDropLatLng,
                            bottomPadding: box.maxHeight * sheetMin,
                          ),
                        ),
                      ),
                      DraggableScrollableSheet(
                        initialChildSize: sheetMin,
                        minChildSize: sheetMin,
                        maxChildSize: 0.94,
                        snap: true,
                        builder: (context, scroll) => DecoratedBox(
                          decoration: BoxDecoration(
                            color: p.canvas,
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                            boxShadow: [
                              BoxShadow(color: p.navShadow, blurRadius: 18, offset: const Offset(0, -4)),
                            ],
                          ),
                          child: ListView(
                            controller: scroll,
                            padding: EdgeInsets.fromLTRB(16, 10, 16, 16 + MediaQuery.paddingOf(context).bottom),
                            children: [
                              Center(
                                child: Container(
                                  width: 40,
                                  height: 4,
                                  margin: const EdgeInsets.only(bottom: 12),
                                  decoration: BoxDecoration(color: p.line, borderRadius: BorderRadius.circular(2)),
                                ),
                              ),
                              rise(
                                0,
                                SearchingCard(
                                  bar: searchBar(f),
                                  stage: stage,
                                  message: kSearchStageMessages[stage].tr,
                                ),
                              ),
                              const SizedBox(height: 12),
                              rise(
                                1,
                                WaitingTripCard(
                                  vehicle: _vehicleName,
                                  orderId: widget.orderId,
                                  fare: _tripFare,
                                  pickup: _tripPickup,
                                  drop: _tripDrop,
                                ),
                              ),
                              const SizedBox(height: 12),
                              rise(2, _buildGuaranteeCard(late: stage == 3)),
                              const SizedBox(height: 14),
                              rise(
                                3,
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Icon(Icons.notifications_none_rounded, size: 20, color: p.inkMuted),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                        "You can leave this screen. We'll let you know when a driver accepts.".tr,
                                        style: AppText.caption(p.inkMuted).copyWith(fontSize: 13, height: 1.4),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 8),
                              Center(
                                child: TextButton(
                                  onPressed: _isCancelling ? null : _showCancelDialog,
                                  style: TextButton.styleFrom(minimumSize: const Size(120, 44), foregroundColor: p.inkMuted),
                                  child: _isCancelling
                                      ? SizedBox(
                                          height: 18,
                                          width: 18,
                                          child: CircularProgressIndicator(color: p.inkMuted, strokeWidth: 2),
                                        )
                                      : Text(
                                          "Cancel booking".tr,
                                          style: AppText.body(p.danger).copyWith(fontSize: 14),
                                        ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  );
                }),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One-time entrance: fades in and rises 24 px after [delay].
class _RiseIn extends StatefulWidget {
  const _RiseIn({required this.delay, required this.child});
  final Duration delay;
  final Widget child;

  @override
  State<_RiseIn> createState() => _RiseInState();
}

class _RiseInState extends State<_RiseIn> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 450));
  Timer? _start;

  @override
  void initState() {
    super.initState();
    _start = Timer(widget.delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _start?.cancel();
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final a = CurvedAnimation(parent: _c, curve: Curves.easeOutCubic);
    return AnimatedBuilder(
      animation: a,
      builder: (_, child) => Opacity(
        opacity: a.value,
        child: Transform.translate(offset: Offset(0, 24 * (1 - a.value)), child: child),
      ),
      child: widget.child,
    );
  }
}
