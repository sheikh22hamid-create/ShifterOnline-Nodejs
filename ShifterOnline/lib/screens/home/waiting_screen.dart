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
import 'package:goParcel/screens/home/vehicle_booking_animation.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/utils/booking_guarantee.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/node_socket_manager.dart';
import 'package:goParcel/utils/scheduled_order_watch.dart';
import 'package:lottie/lottie.dart';

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
  int _remainingSeconds = 0;
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
    showDialog(
      context: context,
      builder: (context) {
        return Dialog(
          backgroundColor: Colors.white,
          insetPadding: const EdgeInsets.symmetric(horizontal: 22),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 20, 18, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.campaign_rounded, color: Color(0xFFE53935), size: 28),
                    const SizedBox(width: 8),
                    Text("Cancel Order?".tr, style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 22, color: Color(0xFF1F2937))),
                  ],
                ),
                const SizedBox(height: 8),
                Center(
                  child: Text(
                    "Wait! You Could Still Get Extra Benefits!".tr,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 15, color: Color(0xFFE53935)),
                  ),
                ),
                const SizedBox(height: 8),
                Text("If you wait a little longer, you may get:".tr,
                    style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 14, color: Color(0xFF4B5563))),
                const SizedBox(height: 10),
                _cancelBenefit(
                  icon: Icons.currency_rupee_rounded,
                  color: const Color(0xFF2E9E5B),
                  background: const Color(0xFFE6F6EC),
                  title: "100% Booking Refund".tr,
                  body: "Your booking may be confirmed with a full refund.".tr,
                ),
                const SizedBox(height: 10),
                _cancelBenefit(
                  icon: Icons.verified_user_rounded,
                  color: const Color(0xFF2563EB),
                  background: const Color(0xFFE6EFFC),
                  title: "Get Compensation Benefit".tr,
                  body: "Don't lose chance for compensation benefit.".tr,
                ),
                const SizedBox(height: 14),
                Text("Do you still want to cancel this order?".tr,
                    style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14, color: Color(0xFF1F2937))),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFE5E7EB),
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(vertical: 13),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        onPressed: () => Navigator.pop(context),
                        child: Text("No, Keep Booking".tr,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Color(0xFF374151), fontFamily: 'Gilroy_Bold', fontSize: 14)),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFEF2B2D),
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(vertical: 13),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        onPressed: () {
                          Navigator.pop(context);
                          pksCancleOrder(comment: "Cancelled by user during driver search");
                        },
                        child: Text("Yes, Cancel".tr,
                            style: const TextStyle(color: Colors.white, fontFamily: 'Gilroy_Bold', fontSize: 14)),
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
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: color.withOpacity(0.15), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 15, color: color)),
                const SizedBox(height: 2),
                Text(body, style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 12.5, color: Color(0xFF4B5563))),
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
        ApiWrapper.showToastMessage("🎉 Free Ride Chance Won! Full fare will be credited to your wallet upon completion.".tr);
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
    _timeoutTimer?.cancel();
    _countdownTicker?.cancel();
    _timeoutSet = false;
    _persistWaitingOrder(DateTime.now().millisecondsSinceEpoch + seconds * 1000);
    _startTimeout(seconds, displayDeadline: deadline);
  }

  /// Ticks the on-screen countdown once a second toward [deadline].
  void _startCountdown(DateTime? deadline) {
    if (deadline != null) _timerDeadline = deadline;
    _countdownTicker?.cancel();
    _refreshRemaining();
    if (mounted) setState(() {});
    _countdownTicker = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_isDisposed) { t.cancel(); return; }
      setState(_refreshRemaining);
    });
  }

  void _refreshRemaining() {
    final d = _timerDeadline;
    _remainingSeconds = d == null ? 0 : d.difference(DateTime.now()).inSeconds.clamp(0, 1 << 30).toInt();
  }

  String _formatRemaining() {
    final m = (_remainingSeconds ~/ 60).toString().padLeft(2, '0');
    final s = (_remainingSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  /// The Booking Guarantee card under the timer: the compensation amount, the referral condition still
  /// pending, or "no compensation" — all from backend data.
  Widget _buildGuaranteeCard() {
    final IconData icon;
    final Color tone;
    final Color background;
    final List<Widget> lines;
    const bold = TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14.5, color: Color(0xFF1F2937));
    const soft = TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 12.5, color: Color(0xFF6B7280));
    if (_searchGuarantee == 'locked') {
      icon = Icons.hourglass_bottom_rounded;
      tone = const Color(0xFFF59E0B);
      background = const Color(0xFFFFF4DC);
      final n = _referralsNeeded > 0 ? _referralsNeeded : 1;
      lines = [
        Text("Complete required referrals to unlock compensation benefit.".tr, style: bold),
        const SizedBox(height: 2),
        Text(n == 1 ? "You need 1 more referral to be eligible.".tr : "You need $n more referrals to be eligible.".tr, style: soft),
      ];
    } else if (_guaranteeAmount > 0) {
      icon = Icons.verified_user_rounded;
      tone = const Color(0xFF2E9E5B);
      background = const Color(0xFFE6F6EC);
      lines = [
        Text("If we can't find a driver, you will receive compensation of".tr, style: bold),
        Text(rupeesText(_guaranteeAmount), style: bold.copyWith(color: const Color(0xFF2E9E5B), fontSize: 16)),
      ];
    } else {
      icon = Icons.info_rounded;
      tone = const Color(0xFF6B7280);
      background = const Color(0xFFF3F4F6);
      lines = [
        Text("If we can't find a driver, no compensation is available for this booking.".tr, style: bold),
      ];
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(16)),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(color: tone.withOpacity(0.18), shape: BoxShape.circle),
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
    return WillPopScope(
      onWillPop: () async {
        _navigateBackToHome();
        return false;
      },
      child: Scaffold(
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
              // AppBar with back button & Home shortcut
              const SocketStatusBanner(),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 6.0),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    InkWell(
                      onTap: _navigateBackToHome,
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.2),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 22),
                      ),
                    ),
                    TextButton.icon(
                      onPressed: _navigateBackToHome,
                      icon: const Icon(Icons.home_rounded, color: Colors.white, size: 18),
                      label: Text(
                        "Home".tr,
                        style: const TextStyle(
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 14,
                          color: Colors.white,
                        ),
                      ),
                      style: TextButton.styleFrom(
                        backgroundColor: Colors.white.withOpacity(0.18),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      ),
                    ),
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
                        // The booked vehicle, animated (Bike / E-Loader / 3 Wheeler / 4 Wheeler); the
                        // generic Lottie below is only the fallback when the vehicle is not known.
                        if (_vehicleName.isNotEmpty)
                          VehicleBookingAnimation(vehicleName: _vehicleName, height: 170)
                        else
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
                        const SizedBox(height: 15),

                        // ── Waiting Time Countdown
                        Text(
                          "Searching for a driver".tr,
                          style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 14, color: Colors.white70),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.18),
                            borderRadius: BorderRadius.circular(30),
                            border: Border.all(color: Colors.white.withOpacity(0.35)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.access_time_rounded, color: Colors.white, size: 22),
                              const SizedBox(width: 10),
                              Text(
                                _timerDeadline != null ? _formatRemaining() : "—",
                                style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 22, color: Colors.white),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        _buildGuaranteeCard(),

                        const SizedBox(height: 20),

                        // ── Cancel Order Button
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
      ),
    );
  }
}
