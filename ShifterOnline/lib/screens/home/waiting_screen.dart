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
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/node_socket_manager.dart';
import 'package:goParcel/utils/scheduled_order_watch.dart';
import 'package:lottie/lottie.dart';

class WaitingScreen extends StatefulWidget {
  final String orderId;
  const WaitingScreen({Key? key, required this.orderId}) : super(key: key);

  @override
  State<WaitingScreen> createState() => _WaitingScreenState();
}

class _WaitingScreenState extends State<WaitingScreen> {
  static const _waitingOrderKey = 'active_waiting_order_id';
  static const _waitingExpiryKey = 'active_waiting_expires_at';
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
  NodeSocketSubscription? _socketSubscription;

  static void clearPersistedWaitingOrder() {
    getdata.remove(_waitingOrderKey);
    getdata.remove(_waitingExpiryKey);
  }

  void _persistWaitingOrder(int expiresAt) {
    getdata.write(_waitingOrderKey, widget.orderId);
    getdata.write(_waitingExpiryKey, expiresAt);
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

      final flow = int.tryParse((order['order_status'] ?? order['Order_flow_id'] ?? '').toString());
      final riderId = int.tryParse((order['rid'] ?? order['rider_id'] ?? '').toString()) ?? 0;
      final guarantee = order['guarantee'];
      if (guarantee is Map) {
        final g = Map<String, dynamic>.from(guarantee);
        if (g['state'] == 'pending') {
          _enterGuaranteeWait(parseGuaranteeAmount(g['amount']));
          return;
        }
      }
      if (riderId > 0 || (flow != null && flow >= 1 && flow <= 3)) {
        _handedOffToTracking = true;
        clearPersistedWaitingOrder();
        Get.off(() => TrackingWay(type: "Pickup", initialOrderData: order));
      } else if (flow == 4) {
        clearPersistedWaitingOrder();
        final g = order['guarantee'];
        final paid = g is Map && g['state'] == 'paid' ? parseGuaranteeAmount(g['amount']) : 0.0;
        ApiWrapper.showToastMessage(noDriverMessage(paid).tr);
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
      ApiWrapper.showToastMessage(noDriverMessage(parseGuaranteeAmount(data['compensation_amount'])).tr);
      Get.offAll(() => const Bottombar());
    }, onGuaranteePending: (data) {
      if (data['order_id']?.toString() != widget.orderId) return;
      _enterGuaranteeWait(parseGuaranteeAmount(data['amount']));
    });
  }

  /// The order is being held for an admin to assign a driver (Booking Guarantee). The 130 s safety timer
  /// would otherwise dump the customer on Home while their order is still alive, so stop it.
  void _enterGuaranteeWait(double amount) {
    if (_isDisposed) return;
    _timeoutTimer?.cancel();
    _countdownTicker?.cancel();
    clearPersistedWaitingOrder();
    setState(() {
      _guaranteePending = true;
      _guaranteeAmount = amount;
    });
  }

  /// Auto-close safety net — normally superseded by a socket event above.
  void _startTimeout(int seconds) {
    if (_timeoutSet || seconds <= 0) return;
    _timeoutSet = true;

    _remainingSeconds = seconds;
    setState(() {});

    _countdownTicker = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_isDisposed) { t.cancel(); return; }
      setState(() {
        _remainingSeconds = (_remainingSeconds - 1).clamp(0, seconds);
      });
    });

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
                        // Attractive Lottie Animation with fallback
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
                        if (_guaranteePending) ...[
                          Text(
                            "We're arranging a driver for you. This can take a few minutes.".tr,
                            style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 14, color: Colors.white70),
                            textAlign: TextAlign.center,
                          ),
                          if (guaranteeLine(_guaranteeAmount) != null) ...[
                            const SizedBox(height: 12),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.18),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: Colors.white.withOpacity(0.35)),
                              ),
                              child: Text(
                                guaranteeLine(_guaranteeAmount)!.tr,
                                style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 15, color: Colors.white),
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ],
                        ] else
                        Column(
                          children: [
                            Text(
                              "Auto-closing in".tr,
                              style: const TextStyle(
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 14,
                                color: Colors.white60,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.18),
                                borderRadius: BorderRadius.circular(30),
                                border: Border.all(color: Colors.white.withOpacity(0.35)),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withOpacity(0.08),
                                    blurRadius: 12,
                                    offset: const Offset(0, 5),
                                  ),
                                ],
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.timer_outlined, color: Colors.white, size: 22),
                                  const SizedBox(width: 10),
                                  Text(
                                    _timeoutSet ? "${_remainingSeconds}s" : "—",
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 22,
                                      color: Colors.white,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),

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
