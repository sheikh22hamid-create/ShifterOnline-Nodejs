// ignore_for_file: deprecated_member_use, prefer_typing_uninitialized_variables

import 'dart:async';
import 'dart:convert';
import 'dart:developer';
import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_phone_direct_caller/flutter_phone_direct_caller.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img_lib;
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:goParcel/Api/Api_wrapper.dart';
import 'package:goParcel/Api/AppModelApi/payment_gatwey_api_model.dart';
import 'package:goParcel/Api/config.dart';
import 'package:goParcel/Payment/InputFormater.dart';
import 'package:goParcel/Payment/Payment_card.dart';
import 'package:goParcel/Payment/pay_stack_payment.dart';
import 'package:goParcel/Payment/paypal/src/screens/paypal_screen.dart';
import 'package:goParcel/Payment/razor_pay.dart';
import 'package:goParcel/Payment/web_view.dart';
import 'package:goParcel/bottombar.dart';
import 'package:goParcel/screens/home/chatscreen.dart';
import 'package:goParcel/screens/home/trackingpoliyline.dart';
import 'package:goParcel/screens/home/trackingview.dart';
import 'package:goParcel/screens/myorder/live_driver_tracking.dart';
import 'package:goParcel/screens/profile/faq.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:goParcel/utils/node_socket_manager.dart';
import 'package:goParcel/utils/scheduled_order_watch.dart';
import 'package:goParcel/utils/Calculation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../home/home.dart';

class TrackingWay extends StatefulWidget {
  final String? type;
  final String? uid0;
  final bool? isback;
  final Map<String, dynamic>? initialOrderData;
  const TrackingWay({
    super.key,
    this.type,
    this.uid0,
    this.isback,
    this.initialOrderData,
  });

  @override
  State<TrackingWay> createState() => _TrackingWayState();
}

class _TrackingWayState extends State<TrackingWay> with TickerProviderStateMixin {
  final commit = TextEditingController();
  bool isLoading = false;
  var orderProduc;
  int riderrate = 0;
  String uid = "0";
  String orderid = "0";
  bool isFavorite = false;
  bool isFavoriteLoading = false;
  bool isInvoiceLoading = false;
  bool isAdvanceDialogOpened = false;
  bool isAdvancePaymentFlow = false;
  bool _advancePaymentCompleted = false;
  NodeSocketSubscription? _socketSubscription;
  String? razorpayOrderId;
  Timer? _advanceTimer;
  int _remainingSeconds = 0;
  bool _redeemingReferralPoints = false;

  // Latest driver position from the Node socket.
  double? liveDriverLat;
  double? liveDriverLng;

  // Live tracking map: the marker's CURRENT rendered position (mid-animation
  // between the last two pings, not necessarily the latest raw ping) plus
  // the heading it's animating along, and the vehicle-category icon loaded
  // once per category so it isn't re-fetched on every rebuild.
  GoogleMapController? _liveMapController;
  LatLng? _driverMapPosition;
  final ValueNotifier<LatLng?> _driverMapPositionNotifier = ValueNotifier<LatLng?>(null);
  double _driverMapBearing = 0;
  BitmapDescriptor? _driverIcon;
  String? _driverIconCategory;
  AnimationController? _driverAnimController;
  bool _mapFitted = false;

  @override
  void dispose() {
    _advanceTimer?.cancel();
    _driverAnimController?.dispose();
    _driverMapPositionNotifier.dispose();
    commit.dispose();
    numController.dispose();
    _socketSubscription?.dispose();
    NodeSocketManager.instance.connectionState.removeListener(_refreshAfterReconnect);
    super.dispose();
  }

  void _refreshAfterReconnect() {
    if (!mounted || NodeSocketManager.instance.connectionState.value != SocketConnectionState.connected) return;
    pageRefresh();
  }

  void _listenForLiveUpdates() {
    NodeSocketManager.instance.joinOrder(orderid);

    _socketSubscription = NodeSocketManager.instance.addListeners(onOrderAssigned: (data) {
      if (!mounted || data['order_id']?.toString() != orderid) return;
      // Already handling this order's assignment here — clear it from the
      // scheduled-order catch-up watch list so Bottombar's app-wide
      // listener doesn't also navigate to a second TrackingWay instance.
      ScheduledOrderWatch.remove(orderid);
      debugPrint("🔔 order:assigned (tracking screen refresh): $data");
      final assignedLat = double.tryParse(data['rider_lat']?.toString() ?? '');
      final assignedLng = double.tryParse(data['rider_lng']?.toString() ?? '');
      if (assignedLat != null && assignedLng != null) {
        liveDriverLat = assignedLat;
        liveDriverLng = assignedLng;
        _animateDriverTo(LatLng(assignedLat, assignedLng));
      }
      pageRefresh();
    }, onStatusChanged: (data) {

      if (!mounted || data['order_id']?.toString() != orderid) return;
      final eventId = data['event_id']?.toString();
      if (eventId != null && !_seenTripEvents.add(eventId)) return;
      final message = data['message']?.toString();
      if (message != null && message.isNotEmpty) ApiWrapper.showToastMessage(message);
      debugPrint("🔔 order:status_changed: $data");
      pageRefresh();
    }, onOrderCompleted: (data) {

      if (!mounted || data['order_id']?.toString() != orderid) return;
      debugPrint("🔔 order:completed: $data");
      pageRefresh();
    }, onDriverCancelled: (data) {

      if (!mounted || data['order_id']?.toString() != orderid) return;
      debugPrint('[TrackingWay] order:driver_cancelled: $data');

      // Refresh the order details immediately instead of leaving the old
      // accepted/processing state on screen.
      pageRefresh();

      final refundStatus = data['refund_status']?.toString();
      final refundAmount = data['refund_amount']?.toString();
      if (refundStatus == 'refunded_to_wallet') {
        ApiWrapper.showToastMessage(
          'Driver cancelled. Advance ₹$refundAmount was credited to your wallet.',
        );
      } else if (refundStatus == 'payment_not_captured') {
        ApiWrapper.showToastMessage(
          'Driver cancelled. Payment was not captured; no wallet credit was required.',
        );
      } else {
        ApiWrapper.showToastMessage(
          'Driver cancelled. Finding another driver for your order.',
        );
      }
    });
  }

  String _formatTimerText(int seconds) {
    int minutes = seconds ~/ 60;
    int secs = seconds % 60;
    return "${minutes.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}";
  }

  // ── Live tracking map ─────────────────────────────────────────────────
  // Loads the SAME vehicle-category icon the booking flow uses (pickupiteam,
  // the home screen's catalog — see select_vehicle.dart's identical lookup)
  // so a bike order shows a bike on the map and a 4-wheeler order shows a
  // 4-wheeler, not a generic pin. Falls back to a plain colored pin if the
  // category has no catalog image or the download fails.
  Future<void> _loadDriverIcon(String categoryName) async {
    if (categoryName.isEmpty || _driverIconCategory == categoryName) return;
    _driverIconCategory = categoryName;

    String imagePath = '';
    for (final item in pickupiteam) {
      if (item is Map && (item['cat_name']?.toString() ?? '').toLowerCase() == categoryName.toLowerCase()) {
        imagePath = item['cat_img']?.toString() ?? '';
        break;
      }
    }

    BitmapDescriptor icon = BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueViolet);
    if (imagePath.isNotEmpty) {
      try {
        final response = await http.get(Uri.parse('${Config.imageURLPath}$imagePath')).timeout(const Duration(seconds: 8));
        if (response.statusCode == 200) {
          final decoded = img_lib.decodeImage(response.bodyBytes);
          if (decoded != null) {
            final resized = img_lib.copyResize(decoded, width: 110);
            icon = BitmapDescriptor.fromBytes(Uint8List.fromList(img_lib.encodePng(resized)));
          }
        }
      } catch (e) {
        debugPrint('[TrackingWay] driver icon load failed: $e');
      }
    }
    if (!mounted) return;
    setState(() => _driverIcon = icon);
  }

  // Compass bearing (0-360, 0 = north) from start to end, so the vehicle
  // icon can rotate to face the direction it's actually moving instead of
  // always pointing the same way.
  double _bearingBetween(LatLng start, LatLng end) {
    final lat1 = start.latitude * math.pi / 180;
    final lat2 = end.latitude * math.pi / 180;
    final dLng = (end.longitude - start.longitude) * math.pi / 180;
    final y = math.sin(dLng) * math.cos(lat2);
    final x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dLng);
    return (math.atan2(y, x) * 180 / math.pi + 360) % 360;
  }

  // Driver pings land every ~10s (LocationUpdateService's UPDATE_INTERVAL).
  // Snapping the marker straight to each new ping would look like it's
  // teleporting once a second; this tweens it smoothly across the gap
  // instead, so it reads as continuous movement ("chalta hua") rather than
  // jumping. Duration is a hair under the ping interval so one animation
  // finishes just before the next ping restarts it.
  void _animateDriverTo(LatLng target) {
    final start = _driverMapPosition;
    if (start != null && start.latitude == target.latitude && start.longitude == target.longitude) return;

    if (start != null) {
      _driverMapBearing = _bearingBetween(start, target);
    }
    _driverMapPosition = target;
    _driverMapPositionNotifier.value = target;

    _driverAnimController?.dispose();
    final controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 9000));
    _driverAnimController = controller;
    final latAnim = Tween<double>(begin: (start ?? target).latitude, end: target.latitude).animate(controller);
    final lngAnim = Tween<double>(begin: (start ?? target).longitude, end: target.longitude).animate(controller);
    controller.addListener(() {
      if (!mounted) return;
      final newPos = LatLng(latAnim.value, lngAnim.value);
      _driverMapPosition = newPos;
      _driverMapPositionNotifier.value = newPos;
    });
    controller.forward();
  }

  void _seedDriverPositionFromOrder(Map<String, dynamic>? order) {
    if (order == null) return;
    final lat = double.tryParse((order['rider_lats'] ?? order['rider_lat'] ?? order['rlats'])?.toString() ?? '');
    final lng = double.tryParse((order['rider_longs'] ?? order['rider_lng'] ?? order['rlongs'])?.toString() ?? '');
    if (lat == null || lng == null) return;
    liveDriverLat = lat;
    liveDriverLng = lng;
    _driverMapPosition = LatLng(lat, lng);
    _driverMapPositionNotifier.value = LatLng(lat, lng);
    _animateDriverTo(LatLng(lat, lng));
  }

  Set<Marker> _buildMapMarkers() {
    final markers = <Marker>{};
    final pLat = double.tryParse(orderProduc?['plat']?.toString() ?? '');
    final pLng = double.tryParse(orderProduc?['plong']?.toString() ?? '');
    final dLat = double.tryParse(orderProduc?['dlat']?.toString() ?? '');
    final dLng = double.tryParse(orderProduc?['dlong']?.toString() ?? '');
    if (pLat != null && pLng != null) {
      markers.add(Marker(
        markerId: const MarkerId('pickup'),
        position: LatLng(pLat, pLng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
      ));
    }
    if (dLat != null && dLng != null) {
      markers.add(Marker(
        markerId: const MarkerId('drop'),
        position: LatLng(dLat, dLng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
      ));
    }
    final status = orderProduc?['Order_Status']?.toString().toLowerCase();
    final isFinished = status == 'completed' || status == 'cancelled';
    if (_driverMapPosition != null && !isFinished) {
      markers.add(Marker(
        markerId: const MarkerId('driver'),
        position: _driverMapPosition!,
        icon: _driverIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueViolet),
        rotation: _driverMapBearing,
        anchor: const Offset(0.5, 0.5),
        flat: true,
        zIndex: 2,
      ));
    }
    return markers;
  }

  // One-time bounds fit across pickup/drop/driver — re-fitting on every
  // single location ping would fight the user's own pan/zoom, so this only
  // ever runs once per screen instance (see _mapFitted).
  void _fitMapToMarkers() {
    if (_mapFitted || _liveMapController == null) return;
    final points = <LatLng>[];
    final pLat = double.tryParse(orderProduc?['plat']?.toString() ?? '');
    final pLng = double.tryParse(orderProduc?['plong']?.toString() ?? '');
    final dLat = double.tryParse(orderProduc?['dlat']?.toString() ?? '');
    final dLng = double.tryParse(orderProduc?['dlong']?.toString() ?? '');
    if (pLat != null && pLng != null) points.add(LatLng(pLat, pLng));
    if (dLat != null && dLng != null) points.add(LatLng(dLat, dLng));
    if (_driverMapPosition != null) points.add(_driverMapPosition!);
    if (points.length < 2) return;

    _mapFitted = true;
    var minLat = points.first.latitude, maxLat = points.first.latitude;
    var minLng = points.first.longitude, maxLng = points.first.longitude;
    for (final p in points) {
      minLat = math.min(minLat, p.latitude);
      maxLat = math.max(maxLat, p.latitude);
      minLng = math.min(minLng, p.longitude);
      maxLng = math.max(maxLng, p.longitude);
    }
    // Avoid an excessively close zoom (or invalid bounds) for short routes.
    if ((maxLat - minLat).abs() < 0.002 && (maxLng - minLng).abs() < 0.002) {
      _liveMapController!.animateCamera(CameraUpdate.newCameraPosition(
        CameraPosition(
          target: LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2),
          zoom: 12.5,
        ),
      ));
      return;
    }
    _liveMapController!.animateCamera(CameraUpdate.newLatLngBounds(
      LatLngBounds(southwest: LatLng(minLat, minLng), northeast: LatLng(maxLat, maxLng)), 100));
  }

// _liveTrackingMapCard replaced by _buildLiveTrackingCard below

  // -----------------------------------------------
  var buyMapinfo;
  dynamic grandTotal = "0";
  bool payshow = false;
  int _groupValue = 0;
  String? paymenttital;
  var numController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  final _paymentCard = PaymentCard();
  bool isPaymentLoding = false;
  final _card = PaymentCard();
  var _autoValidateMode = AutovalidateMode.disabled;

  RazorPayClass razorPayClass = RazorPayClass();
  // -----------------------------------------------

  @override
  void initState() {
    super.initState();
    NodeSocketManager.instance.connectionState.addListener(_refreshAfterReconnect);
    uid = widget.uid0 ?? getdata.read("Uid") ?? "";
    orderid = (getdata.read("OrderID") ?? "0").toString();
    if (widget.initialOrderData != null) {
      // Avoid a visible delay while /api/order/details is in flight. This
      // snapshot came from the same successful driver-accept transaction.
      orderProduc = Map<String, dynamic>.from(widget.initialOrderData!);
      _seedDriverPositionFromOrder(orderProduc);
      final assignedOrderId = orderProduc["order_id"]?.toString();
      if (assignedOrderId != null && assignedOrderId.isNotEmpty) {
        orderid = assignedOrderId;
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) checkAdvancePaymentStatus();
      });
    }
    _listenForLiveUpdates();
    paymenrgatway();
    razorPayClass.initiateRazorPay(
      handlePaymentSuccess: handlePaymentSuccess,
      handlePaymentError: handlePaymentError,
      handleExternalWallet: handleExternalWallet,
    );
    pageRefresh();
  }

  void handlePaymentSuccess(PaymentSuccessResponse response) {
    debugPrint("++++++++++++++++++++++++ Payment success : ${response.paymentId}");
    if (isAdvancePaymentFlow) {
      callAdvancePaymentApi(
        paymentId: response.paymentId ?? "",
        signature: response.signature ?? "",
      );
    } else {
      billPayApi("${response.paymentId}");
    }
  }

  void handlePaymentError(PaymentFailureResponse response) {
    debugPrint("++++++++++++++++++++++++ Payment failed : $response");
  }

  void handleExternalWallet(ExternalWalletResponse response) {}

  Future pageRefresh() async {
    if (widget.type == "Pickup") {
      pkgOrder();
      mapinfo();
    } else {
      buyorderDetail();
      buyMapinfoget();
    }
  }

  Color statusColor = Colors.orange;

  // ── HELPER FORMATTERS & STATUS MAPPINGS ───────────────────────────────────

  String _formatOrderDate(String? rawDate) {
    if (rawDate == null || rawDate.isEmpty) return "";
    try {
      final dt = DateTime.parse(rawDate);
      return DateFormat("EEE, d MMM, yyyy • hh:mm a").format(dt);
    } catch (_) {
      return rawDate;
    }
  }

  int _getCurrentStepIndex(String? status) {
    final s = (status ?? "").toLowerCase().trim();
    if (s == "completed") return 4;
    if (s == "on route" || s == "on_route" || s == "intransit" || s == "in transit") return 3;
    if (s == "pickup" || s == "picked up" || s == "picked_up") return 2;
    if (s == "processing" || s == "pending") return 1;
    return 1;
  }

  Color _getStatusColor(String? status) {
    final s = (status ?? "").toLowerCase().trim();
    if (s == "completed") return const Color(0xFF00C853);
    if (s == "cancelled") return const Color(0xFFFF5252);
    if (s == "on route" || s == "on_route" || s == "intransit") return const Color(0xFF2979FF);
    if (s == "pickup") return const Color(0xFFFF9100);
    return linercolor;
  }

  Color _getStatusBgColor(String? status) {
    final s = (status ?? "").toLowerCase().trim();
    if (s == "completed") return const Color(0xFFE8F8EE);
    if (s == "cancelled") return const Color(0xFFFFEEEE);
    if (s == "on route" || s == "on_route" || s == "intransit") return const Color(0xFFEBF3FF);
    if (s == "pickup") return const Color(0xFFFFF4E5);
    return const Color(0xFFFFF3E8);
  }

  IconData _getStatusIcon(String? status) {
    final s = (status ?? "").toLowerCase().trim();
    if (s == "completed") return Icons.check_circle_rounded;
    if (s == "cancelled") return Icons.cancel_rounded;
    if (s == "on route" || s == "on_route") return Icons.delivery_dining_rounded;
    if (s == "pickup") return Icons.inventory_rounded;
    return Icons.access_time_rounded;
  }

  String _getContextualSubtitle(String? status) {
    final s = (status ?? "").toLowerCase().trim();
    if (s == "completed") return "Package delivered successfully".tr;
    if (s == "cancelled") return "Order has been cancelled".tr;
    if (s == "on route" || s == "on_route") return "Rider is on the way to drop location".tr;
    if (s == "pickup") return "Rider has arrived at pickup".tr;
    return "Rider is picking up your order".tr;
  }

  // ── 1. TOP HEADER ─────────────────────────────────────────────────────────

  Widget _buildModernHeader() {
    return Container(
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 6,
        left: 16,
        right: 16,
        bottom: 14,
      ),
      decoration: BoxDecoration(
        color: linercolor,
        gradient: LinearGradient(
          colors: [linercolor, const Color(0xFFFF7A45)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Row(
        children: [
          InkWell(
            onTap: () {
              if (orderProduc != null &&
                  (orderProduc["payment_status"] ?? "").toString() != "1" &&
                  _isAdvancePaymentRequiredForOrder) {
                return;
              }
              if (orderProduc != null && orderProduc["Order_Status"] == "Completed") {
                if (widget.isback == true) {
                  Get.back();
                } else {
                  Get.offAll(() => Bottombar());
                }
              } else {
                Get.back();
              }
            },
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 20),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  "Order Details".tr,
                  style: const TextStyle(
                    color: Colors.white,
                    fontFamily: "Gilroy_Bold",
                    fontSize: 19,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  "Track and manage your order".tr,
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.85),
                    fontFamily: "Gilroy_Medium",
                    fontSize: 11.5,
                  ),
                ),
              ],
            ),
          ),
          // Actions
          // [ 🗺 View Map ] - Only visible for active in-progress orders
          if (!((orderProduc?["Order_Status"] ?? "").toString().toLowerCase() == "completed" ||
              (orderProduc?["Order_Status"] ?? "").toString().toLowerCase() == "cancelled" ||
              (orderProduc?["Order_Status"] ?? "").toString().toLowerCase() == "cancel")) ...[
            InkWell(
              onTap: () {
                if (orderProduc != null && orderProduc["rider_id"] != null) {
                  Get.to(() => LiveDriverTracking(
                        orderId: orderid,
                        type: widget.type,
                        initialOrderData: Map<String, dynamic>.from(orderProduc),
                      ));
                } else {
                  Get.to(() => Tracklast(type: "OrderDone"));
                }
              },
              borderRadius: BorderRadius.circular(16),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.22),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white.withOpacity(0.4)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.map_rounded, color: Colors.white, size: 14),
                    const SizedBox(width: 4),
                    Text(
                      "View Map".tr,
                      style: const TextStyle(
                        color: Colors.white,
                        fontFamily: "Gilroy_Bold",
                        fontSize: 11.5,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          // [ ↻ Refresh ]
          InkWell(
            onTap: isLoading ? null : () => pageRefresh(),
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: isLoading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.refresh_rounded, color: Colors.white, size: 18),
            ),
          ),
          const SizedBox(width: 8),
          // [ ? Help ]
          InkWell(
            onTap: () => _showHelpAndSupportSheet(),
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.help_outline_rounded, color: Colors.white, size: 18),
            ),
          ),
        ],
      ),
    );
  }

  void _showHelpAndSupportSheet() {
    final careNumber = (orderProduc?["customer_care_number"] ?? "+91 9999908008").toString();
    Get.bottomSheet(
      Container(
        padding: const EdgeInsets.all(22),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 44,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: const BoxDecoration(
                color: Color(0xFFE8F8EE),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.headset_mic_rounded, color: Color(0xFF00C853), size: 30),
            ),
            const SizedBox(height: 12),
            Text(
              "Need Help with Your Order?".tr,
              style: const TextStyle(
                fontFamily: "Gilroy_Bold",
                fontSize: 18,
                color: Color(0xFF0F172A),
              ),
            ),
            const SizedBox(height: 5),
            Text(
              "Our support team is available 24/7 to assist you".tr,
              style: const TextStyle(
                fontFamily: "Gilroy_Medium",
                fontSize: 12.5,
                color: Color(0xFF64748B),
              ),
            ),
            const SizedBox(height: 20),
            // Option 1: Call Customer Care
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () {
                  Get.back();
                  makePhoneCall(careNumber);
                },
                borderRadius: BorderRadius.circular(16),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F8EE),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFF00C853).withOpacity(0.35)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: const BoxDecoration(
                          color: Color(0xFF00C853),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.call_rounded, color: Colors.white, size: 20),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              "Call Customer Care Helpline".tr,
                              style: const TextStyle(
                                fontFamily: "Gilroy_Bold",
                                fontSize: 14.5,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              careNumber,
                              style: const TextStyle(
                                fontFamily: "Gilroy_Medium",
                                fontSize: 13,
                                color: Color(0xFF00C853),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Color(0xFF00C853)),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            // Option 2: View FAQs
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () {
                  Get.back();
                  Get.to(() => Faq());
                },
                borderRadius: BorderRadius.circular(16),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.blue.shade50,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(Icons.question_mark_rounded, color: Colors.blue.shade700, size: 20),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              "Frequently Asked Questions".tr,
                              style: const TextStyle(
                                fontFamily: "Gilroy_Bold",
                                fontSize: 14,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              "Find answers to common questions".tr,
                              style: const TextStyle(
                                fontFamily: "Gilroy_Medium",
                                fontSize: 12,
                                color: Color(0xFF64748B),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Color(0xFF94A3B8)),
                    ],
                  ),
                ),
              ),
            ),
            SizedBox(height: MediaQuery.of(context).padding.bottom + 8),
          ],
        ),
      ),
      isScrollControlled: true,
    );
  }

  // ── 2. ORDER SUMMARY CARD ─────────────────────────────────────────────────

  Widget _buildOrderSummaryCard() {
    final orderIdDisplay = (orderProduc?["order_id"] ?? getdata.read("OrderID") ?? "0").toString();
    final status = (orderProduc?["Order_Status"] ?? "Processing").toString();
    final statusColor = _getStatusColor(status);
    final statusBg = _getStatusBgColor(status);
    final statusIcon = _getStatusIcon(status);
    final dateDisplay = _formatOrderDate(orderProduc?["order_date"]?.toString());
    final contextualSubtitle = _getContextualSubtitle(status);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    "Order #$orderIdDisplay",
                    style: TextStyle(
                      color: notifier.text,
                      fontFamily: "Gilroy_Bold",
                      fontSize: 18,
                    ),
                  ),
                  const SizedBox(width: 8),
                  InkWell(
                    onTap: () {
                      Clipboard.setData(ClipboardData(text: orderIdDisplay));
                      ApiWrapper.showToastMessage("Order ID copied".tr);
                    },
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.all(4.0),
                      child: Icon(Icons.copy_rounded, size: 16, color: linercolor),
                    ),
                  ),
                ],
              ),
              // Dynamic status badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: statusBg,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: statusColor.withOpacity(0.35)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(statusIcon, size: 13, color: statusColor),
                    const SizedBox(width: 4),
                    Text(
                      status.tr,
                      style: TextStyle(
                        color: statusColor,
                        fontFamily: "Gilroy_Bold",
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  dateDisplay.isNotEmpty ? dateDisplay : "Just now",
                  style: TextStyle(
                    color: greaycolor.withOpacity(0.85),
                    fontFamily: "Gilroy_Medium",
                    fontSize: 12,
                  ),
                ),
              ),
              Text(
                contextualSubtitle,
                style: TextStyle(
                  color: greaycolor.withOpacity(0.85),
                  fontFamily: "Gilroy_Medium",
                  fontSize: 11.5,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── 3. ORDER STATUS TIMELINE ──────────────────────────────────────────────

  Widget _buildStatusTimeline() {
    final status = (orderProduc?["Order_Status"] ?? "Processing").toString();
    final stepIndex = _getCurrentStepIndex(status);
    final isCancelled = status.toLowerCase() == "cancelled";

    final steps = [
      {
        "title": "Processing".tr,
        "desc": "Rider is on the way\nto pickup".tr,
        "icon": Icons.inventory_2_outlined,
      },
      {
        "title": "Picked Up".tr,
        "desc": "Rider has collected\nyour package".tr,
        "icon": Icons.local_shipping_outlined,
      },
      {
        "title": "In Transit".tr,
        "desc": "On the way to\ndrop location".tr,
        "icon": Icons.near_me_outlined,
      },
      {
        "title": "Delivered".tr,
        "desc": "Package delivered\nsuccessfully".tr,
        "icon": Icons.check_circle_outline,
      },
    ];

    if (isCancelled) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: const Color(0xFFFFEEEE),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFFFCDD2)),
        ),
        child: Row(
          children: [
            const Icon(Icons.cancel_rounded, color: Color(0xFFFF5252), size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Order Cancelled".tr,
                    style: const TextStyle(
                      color: Color(0xFFFF5252),
                      fontFamily: "Gilroy_Bold",
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    "This order was cancelled. No further deliveries will be made.".tr,
                    style: TextStyle(
                      color: Colors.red.shade800,
                      fontFamily: "Gilroy_Medium",
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: List.generate(7, (index) {
              if (index % 2 == 0) {
                final stepNum = (index ~/ 2) + 1;
                final isCompleted = stepIndex > stepNum;
                final isActive = stepIndex == stepNum;

                Color nodeBg;
                Color iconColor;
                BoxBorder? nodeBorder;

                if (isCompleted) {
                  nodeBg = const Color(0xFFE8F8EE);
                  iconColor = const Color(0xFF00C853);
                  nodeBorder = Border.all(color: const Color(0xFF00C853), width: 1.5);
                } else if (isActive) {
                  nodeBg = linercolor;
                  iconColor = Colors.white;
                  nodeBorder = Border.all(color: linercolor.withOpacity(0.4), width: 4);
                } else {
                  nodeBg = Colors.grey.shade100;
                  iconColor = Colors.grey.shade400;
                  nodeBorder = Border.all(color: Colors.grey.shade300, width: 1);
                }

                return Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: nodeBg,
                    shape: BoxShape.circle,
                    border: nodeBorder,
                  ),
                  child: Center(
                    child: Icon(
                      isCompleted ? Icons.check_rounded : steps[stepNum - 1]["icon"] as IconData,
                      size: 16,
                      color: iconColor,
                    ),
                  ),
                );
              } else {
                final prevStep = (index ~/ 2) + 1;
                final isLineActive = stepIndex > prevStep;

                return Expanded(
                  child: Container(
                    height: 3,
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    decoration: BoxDecoration(
                      color: isLineActive ? linercolor : Colors.grey.shade200,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                );
              }
            }),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: List.generate(4, (i) {
              final stepNum = i + 1;
              final isCurrent = stepIndex == stepNum;
              final isDone = stepIndex > stepNum;

              return Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: Column(
                    children: [
                      Text(
                        steps[i]["title"] as String,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: isCurrent
                              ? linercolor
                              : isDone
                                  ? const Color(0xFF00C853)
                                  : greaycolor,
                          fontFamily: "Gilroy_Bold",
                          fontSize: 11.5,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        steps[i]["desc"] as String,
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: greaycolor.withOpacity(0.75),
                          fontFamily: "Gilroy_Medium",
                          fontSize: 9.5,
                          height: 1.2,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  // ── 4. LIVE DRIVER TRACKING MAP CARD ──────────────────────────────────────

  Widget _buildLiveTrackingCard() {
    final pLat = double.tryParse(orderProduc?['plat']?.toString() ?? '');
    final pLng = double.tryParse(orderProduc?['plong']?.toString() ?? '');
    final hasCoords = pLat != null && pLng != null;

    final category = orderProduc?['category']?.toString() ?? '';
    if (category.isNotEmpty && _driverIconCategory != category) _loadDriverIcon(category);

    final status = (orderProduc?['Order_Status'] ?? '').toString();
    final pAddress = (orderProduc?['customer_paddress'] ?? orderProduc?['store_paddress'] ?? '').toString();
    final dAddress = (orderProduc?['customer_daddress'] ?? '').toString();

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(7),
                      decoration: BoxDecoration(
                        color: linercolor.withOpacity(0.12),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(Icons.sensors_rounded, color: linercolor, size: 18),
                    ),
                    const SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Live Track Driver".tr,
                          style: TextStyle(
                            color: notifier.text,
                            fontFamily: "Gilroy_Bold",
                            fontSize: 15,
                          ),
                        ),
                        Text(
                          "See real-time location".tr,
                          style: TextStyle(
                            color: greaycolor,
                            fontFamily: "Gilroy_Medium",
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                InkWell(
                  onTap: () {
                    Get.to(() => LiveDriverTracking(
                          orderId: orderid,
                          type: widget.type,
                          initialOrderData: Map<String, dynamic>.from(orderProduc ?? {}),
                        ));
                  },
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: linercolor.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: linercolor.withOpacity(0.3)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.open_in_new_rounded, size: 13, color: linercolor),
                        const SizedBox(width: 4),
                        Text(
                          "Open in Maps".tr,
                          style: TextStyle(
                            color: linercolor,
                            fontFamily: "Gilroy_Bold",
                            fontSize: 11.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Map Area with Overlays (smooth preview, non-blocking gestures)
          hasCoords
              ? ClipRRect(
                  child: SizedBox(
                    height: 200,
                    width: double.infinity,
                    child: Stack(
                      children: [
                        ValueListenableBuilder<LatLng?>(
                          valueListenable: _driverMapPositionNotifier,
                          builder: (context, driverPos, _) {
                            return GoogleMap(
                              initialCameraPosition: CameraPosition(
                                target: driverPos ?? LatLng(pLat, pLng),
                                zoom: 13,
                              ),
                              markers: _buildMapMarkers(),
                              myLocationButtonEnabled: false,
                              zoomControlsEnabled: false,
                              scrollGesturesEnabled: false,
                              zoomGesturesEnabled: false,
                              rotateGesturesEnabled: false,
                              tiltGesturesEnabled: false,
                              mapToolbarEnabled: false,
                              onMapCreated: (controller) {
                                _liveMapController = controller;
                                _fitMapToMarkers();
                              },
                            );
                          },
                        ),
                        // Floating ETA / Status Badge
                        ValueListenableBuilder<LatLng?>(
                          valueListenable: _driverMapPositionNotifier,
                          builder: (context, driverPos, _) {
                            if (driverPos == null || status == "Completed" || status == "Cancelled") {
                              return const SizedBox();
                            }
                            return Positioned(
                              top: 10,
                              left: 14,
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: linercolor,
                                  borderRadius: BorderRadius.circular(12),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withOpacity(0.18),
                                      blurRadius: 8,
                                      offset: const Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.two_wheeler_rounded, color: Colors.white, size: 16),
                                    const SizedBox(width: 6),
                                    Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          "Rider is on the way".tr,
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontFamily: "Gilroy_Bold",
                                            fontSize: 11,
                                          ),
                                        ),
                                        if (orderProduc?["distance"] != null)
                                          Text(
                                            "${orderProduc["distance"]} km away",
                                            style: TextStyle(
                                              color: Colors.white.withOpacity(0.9),
                                              fontFamily: "Gilroy_Medium",
                                              fontSize: 9.5,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                )
              : Container(
                  height: 140,
                  width: double.infinity,
                  color: Colors.grey.shade100,
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.location_searching_rounded, size: 30, color: Colors.grey.shade400),
                        const SizedBox(height: 6),
                        Text(
                          "Driver location will be visible once assigned".tr,
                          style: TextStyle(
                            color: Colors.grey.shade600,
                            fontFamily: "Gilroy_Medium",
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

          // Route Addresses
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                // Pickup
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: notifier.lightBgColor,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: notifier.bordecolor.withOpacity(0.5)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(top: 4, right: 8),
                          decoration: const BoxDecoration(
                            color: Colors.orange,
                            shape: BoxShape.circle,
                          ),
                        ),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "Pickup Location".tr,
                                style: TextStyle(
                                  color: greaycolor,
                                  fontFamily: "Gilroy_Medium",
                                  fontSize: 10.5,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                pAddress.isNotEmpty ? pAddress : "Current Location".tr,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: "Gilroy_Bold",
                                  fontSize: 11.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // Drop
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: notifier.lightBgColor,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: notifier.bordecolor.withOpacity(0.5)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.location_on_rounded, size: 14, color: Colors.red),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "Drop Location".tr,
                                style: TextStyle(
                                  color: greaycolor,
                                  fontFamily: "Gilroy_Medium",
                                  fontSize: 10.5,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                dAddress.isNotEmpty ? dAddress : "Destination".tr,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: "Gilroy_Bold",
                                  fontSize: 11.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── 5. QUICK ORDER INFO ───────────────────────────────────────────────────

  Widget _buildQuickOrderInfo() {
    final distance = (orderProduc?["distance"] != null) ? "${orderProduc["distance"]} km" : "0 km";
    final weight = (orderProduc?["package_weight"] != null) ? "${orderProduc["package_weight"]} Kg" : "0 Kg";
    final category = (orderProduc?["category"] ?? "Bike").toString();
    final isScheduled = orderProduc?["booking_type"]?.toString() == "2";
    final bookingType = orderProduc?["booking_type"]?.toString() == "1"
        ? "Current Booking".tr
        : isScheduled
            ? "Schedule Booking".tr
            : "Next Day Booking".tr;
    final rawScheduleTime = orderProduc?["schedule_date_time"]?.toString();
    String? scheduledForLabel;
    if (isScheduled && rawScheduleTime != null && rawScheduleTime.isNotEmpty) {
      final parsed = DateTime.tryParse(rawScheduleTime);
      scheduledForLabel = parsed == null
          ? rawScheduleTime
          : DateFormat('EEE, d MMM · h:mm a').format(parsed.toLocal());
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final isNarrow = constraints.maxWidth < 360;

          Widget buildItem(IconData icon, String title, String value) {
            return Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: linercolor.withOpacity(0.09),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, color: linercolor, size: 18),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: greaycolor,
                          fontFamily: "Gilroy_Medium",
                          fontSize: 11,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: "Gilroy_Bold",
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          }

          if (isNarrow) {
            return Column(
              children: [
                Row(
                  children: [
                    Expanded(child: buildItem(Icons.route_rounded, "Distance".tr, distance)),
                    const SizedBox(width: 8),
                    Expanded(child: buildItem(Icons.shopping_bag_outlined, "Weight".tr, weight)),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: buildItem(Icons.two_wheeler_rounded, "Category".tr, category)),
                    const SizedBox(width: 8),
                    Expanded(child: buildItem(Icons.event_note_rounded, "Booking Type".tr, bookingType)),
                  ],
                ),
                if (scheduledForLabel != null) ...[
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(child: buildItem(Icons.schedule_rounded, "Scheduled For".tr, scheduledForLabel)),
                    ],
                  ),
                ],
              ],
            );
          }

          return Column(
            children: [
              Row(
                children: [
                  Expanded(child: buildItem(Icons.route_rounded, "Distance".tr, distance)),
                  Container(width: 1, height: 32, color: Colors.grey.shade200, margin: const EdgeInsets.symmetric(horizontal: 4)),
                  Expanded(child: buildItem(Icons.shopping_bag_outlined, "Weight".tr, weight)),
                  Container(width: 1, height: 32, color: Colors.grey.shade200, margin: const EdgeInsets.symmetric(horizontal: 4)),
                  Expanded(child: buildItem(Icons.two_wheeler_rounded, "Category".tr, category)),
                  Container(width: 1, height: 32, color: Colors.grey.shade200, margin: const EdgeInsets.symmetric(horizontal: 4)),
                  Expanded(child: buildItem(Icons.event_note_rounded, "Booking Type".tr, bookingType)),
                ],
              ),
              if (scheduledForLabel != null) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: buildItem(Icons.schedule_rounded, "Scheduled For".tr, scheduledForLabel)),
                  ],
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  // ── 6. OTP & RIDER DETAILS SECTION ────────────────────────────────────────

  Widget _buildOtpAndRiderSection() {
    final status = (orderProduc?["Order_Status"] ?? "").toString().trim().toLowerCase();
    final isFinished = status == "completed" || status == "cancelled" || status == "cancel";
    final otp = (orderProduc?["otp"] ?? "").toString();
    final hasOtp = !isFinished && otp.isNotEmpty;

    return LayoutBuilder(
      builder: (context, constraints) {
        final stackVertically = constraints.maxWidth < 360;

        Widget otpCard = hasOtp ? _buildOtpCard(otp) : const SizedBox();
        Widget riderCard = _buildRiderDetailsCard();

        if (!hasOtp) return riderCard;

        if (stackVertically) {
          return Column(
            children: [
              otpCard,
              const SizedBox(height: 12),
              riderCard,
            ],
          );
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 4, child: otpCard),
            const SizedBox(width: 12),
            Expanded(flex: 5, child: riderCard),
          ],
        );
      },
    );
  }

  Widget _buildOtpCard(String otp) {
    final isPickupState = orderProduc?["Order_Status"] == "Pickup";

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7F2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFFFE3D3), width: 1.2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: linercolor.withOpacity(0.14),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.lock_rounded, color: linercolor, size: 15),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    "Your OTP".tr,
                    style: TextStyle(
                      color: greaycolor,
                      fontFamily: "Gilroy_Medium",
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              InkWell(
                onTap: () {
                  Clipboard.setData(ClipboardData(text: otp));
                  ApiWrapper.showToastMessage("OTP Copied".tr);
                },
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(
                    color: linercolor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.copy_rounded, color: linercolor, size: 15),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Center(
            child: Text(
              otp.split('').join(' '),
              style: TextStyle(
                color: linercolor,
                fontFamily: "Gilroy_Bold",
                fontSize: 26,
                letterSpacing: 3,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            "Share this OTP with rider for secure pickup".tr,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: greaycolor.withOpacity(0.85),
              fontFamily: "Gilroy_Medium",
              fontSize: 10.5,
              height: 1.25,
            ),
          ),
          if (isPickupState) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.orange.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                "Driver arrived. Please share OTP within 10 mins.".tr,
                style: TextStyle(
                  color: Colors.orange.shade900,
                  fontFamily: "Gilroy_Bold",
                  fontSize: 9.5,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildRiderDetailsCard() {
    final riderId = (orderProduc?["rider_id"] ?? buyMapinfo?["rider_id"] ?? "").toString().trim();
    final hasRider = riderId.isNotEmpty && riderId != "0" && riderId != "null";

    final riderName = hasRider
        ? (orderProduc?["rider_name"] ?? buyMapinfo?["rider_name"] ?? "Delivery Partner").toString().trim()
        : "Looking for Rider...".tr;

    final riderMobile = (orderProduc?["rider_mobile"] ?? buyMapinfo?["rider_mobile"] ?? "").toString().trim();
    final rawRiderImg = (orderProduc?["rider_img"] ?? buyMapinfo?["rider_img"] ?? "").toString().trim();
    final riderImg = (rawRiderImg.isNotEmpty && rawRiderImg != "null") ? rawRiderImg : "";
    final vehicleNo = (orderProduc?["vehicle_no"] ?? buyMapinfo?["vehicle_no"] ?? "").toString().trim();

    // Real dynamic driver rating
    final rawRiderStar = (orderProduc?["rider_star"] ?? buyMapinfo?["rider_star"] ?? "").toString().trim();
    double? ratingVal = double.tryParse(rawRiderStar);
    final bool hasRating = ratingVal != null && ratingVal > 0;
    final String ratingDisplay = hasRating ? ratingVal.toStringAsFixed(1) : "New";

    // Real dynamic completed orders / trips count
    final rawTrips = (orderProduc?["total_trips"] ??
            orderProduc?["order_count"] ??
            buyMapinfo?["total_trips"] ??
            buyMapinfo?["order_count"] ??
            "")
        .toString()
        .trim();
    int? tripsCount = int.tryParse(rawTrips);
    final bool hasTrips = tripsCount != null && tripsCount > 0;

    final riderStatus = (orderProduc?["Order_Status"] ?? "").toString().trim().toLowerCase();
    final isFinished = riderStatus == "completed" || riderStatus == "cancelled" || riderStatus == "cancel";

    final hasValidPhoto = Config.isValidImageUrl(riderImg);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Rider Details".tr,
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: "Gilroy_Bold",
                  fontSize: 14,
                ),
              ),
              if (hasRider)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F8EE),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: const [
                      Icon(Icons.check_circle_rounded, color: Color(0xFF00C853), size: 12),
                      SizedBox(width: 3),
                      Text(
                        "Verified",
                        style: TextStyle(
                          color: Color(0xFF00C853),
                          fontFamily: "Gilroy_Bold",
                          fontSize: 10.5,
                        ),
                      ),
                    ],
                  ),
                )
              else
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.schedule_rounded, color: Colors.orange.shade800, size: 12),
                      const SizedBox(width: 3),
                      Text(
                        "Assigning".tr,
                        style: TextStyle(
                          color: Colors.orange.shade800,
                          fontFamily: "Gilroy_Bold",
                          fontSize: 10.5,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              // Driver Photo (if available) or clean styled avatar
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: hasValidPhoto ? Colors.transparent : linercolor.withOpacity(0.1),
                  border: Border.all(
                    color: hasValidPhoto ? linercolor.withOpacity(0.3) : Colors.transparent,
                    width: 1.5,
                  ),
                ),
                child: ClipOval(
                  child: hasValidPhoto
                      ? Image.network(
                          Config.resolveImageUrl(riderImg),
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) => Icon(
                            Icons.person_rounded,
                            color: linercolor,
                            size: 26,
                          ),
                        )
                      : Icon(
                          Icons.person_rounded,
                          color: linercolor,
                          size: 26,
                        ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      riderName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: notifier.text,
                        fontFamily: "Gilroy_Bold",
                        fontSize: 13.5,
                      ),
                    ),
                    const SizedBox(height: 2),
                    if (hasRider) ...[
                      Row(
                        children: [
                          const Icon(Icons.star_rounded, color: Color(0xFFFFC107), size: 15),
                          const SizedBox(width: 3),
                          Text(
                            ratingDisplay,
                            style: TextStyle(
                              color: notifier.text,
                              fontFamily: "Gilroy_Bold",
                              fontSize: 11.5,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            hasTrips ? "($tripsCount orders)" : "(New Partner)".tr,
                            style: TextStyle(
                              color: greaycolor,
                              fontFamily: "Gilroy_Medium",
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                      if (vehicleNo.isNotEmpty &&
                          vehicleNo.toLowerCase() != "not available" &&
                          vehicleNo.toLowerCase() != "null") ...[
                        const SizedBox(height: 2),
                        Text(
                          "Vehicle: $vehicleNo",
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: greaycolor.withOpacity(0.85),
                            fontFamily: "Gilroy_Medium",
                            fontSize: 10.5,
                          ),
                        ),
                      ],
                    ] else ...[
                      Text(
                        "Driver details will appear once assigned".tr,
                        style: TextStyle(
                          color: greaycolor,
                          fontFamily: "Gilroy_Medium",
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              // Favorite driver toggle button
              if (hasRider)
                isFavoriteLoading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : InkWell(
                        onTap: () => toggleFavoriteDriver(),
                        borderRadius: BorderRadius.circular(16),
                        child: Padding(
                          padding: const EdgeInsets.all(4.0),
                          child: Icon(
                            isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                            color: isFavorite ? Colors.red : greaycolor,
                            size: 20,
                          ),
                        ),
                      ),
            ],
          ),
          if (hasRider && !isFinished && riderMobile.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      await FlutterPhoneDirectCaller.callNumber(riderMobile);
                    },
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      decoration: BoxDecoration(
                        color: linercolor.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.call_rounded, color: linercolor, size: 15),
                          const SizedBox(width: 5),
                          Text(
                            "Call".tr,
                            style: TextStyle(
                              color: linercolor,
                              fontFamily: "Gilroy_Bold",
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: InkWell(
                    onTap: () {
                      Get.to(() => Chat(
                            receiverId: riderId,
                            receiverMobile: riderMobile,
                            receiverName: riderName,
                            receiverImage: riderImg,
                          ));
                    },
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      decoration: BoxDecoration(
                        color: linercolor.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.chat_bubble_rounded, color: linercolor, size: 15),
                          const SizedBox(width: 5),
                          Text(
                            "Chat".tr,
                            style: TextStyle(
                              color: linercolor,
                              fontFamily: "Gilroy_Bold",
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  // ── 7. PACKAGE INFORMATION CARD (CONDITIONALLY SHOWN) ─────────────────────

  bool _hasPackageInfo() {
    final rawDesc = (orderProduc?["description"] ?? "").toString().trim();
    final hasDescription = rawDesc.isNotEmpty &&
        rawDesc.toLowerCase() != "null" &&
        rawDesc.toLowerCase() != "no description provided";

    final rawPhotos = (orderProduc?["photos"] as List?) ?? [];
    final validPhotos = rawPhotos
        .where((p) => p != null && p.toString().trim().isNotEmpty && p.toString().trim() != "null")
        .toList();
    final hasPhotos = validPhotos.isNotEmpty;

    final hasBuyItems = widget.type != "Pickup" &&
        buyMapinfo != null &&
        (buyMapinfo["item_list"] as List?)?.isNotEmpty == true;

    return hasDescription || hasPhotos || hasBuyItems;
  }

  Widget _buildPackageInfoCard() {
    if (!_hasPackageInfo()) return const SizedBox.shrink();

    final rawDesc = (orderProduc?["description"] ?? "").toString().trim();
    final hasDescription = rawDesc.isNotEmpty &&
        rawDesc.toLowerCase() != "null" &&
        rawDesc.toLowerCase() != "no description provided";

    final rawPhotos = (orderProduc?["photos"] as List?) ?? [];
    final validPhotos = rawPhotos
        .where((p) => p != null && p.toString().trim().isNotEmpty && p.toString().trim() != "null")
        .toList();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: linercolor.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.inventory_2_outlined, color: linercolor, size: 16),
              ),
              const SizedBox(width: 8),
              Text(
                "Package Information".tr,
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: "Gilroy_Bold",
                  fontSize: 15,
                ),
              ),
            ],
          ),
          if (hasDescription) ...[
            const SizedBox(height: 8),
            Text(
              rawDesc,
              style: TextStyle(
                color: greaycolor,
                fontFamily: "Gilroy_Medium",
                fontSize: 13,
              ),
            ),
          ],
          if (validPhotos.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              "Package Attachments".tr,
              style: TextStyle(
                color: notifier.text,
                fontFamily: "Gilroy_Bold",
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 6),
            SizedBox(
              height: 70,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: validPhotos.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, i) => attachment(validPhotos, i),
              ),
            ),
          ],
          // Buy Anything order items
          if (widget.type != "Pickup" && buyMapinfo != null && (buyMapinfo["item_list"] as List?)?.isNotEmpty == true) ...[
            if (hasDescription || validPhotos.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Divider(),
            ],
            const SizedBox(height: 6),
            Text(
              "Order Items".tr,
              style: TextStyle(
                color: notifier.text,
                fontFamily: "Gilroy_Bold",
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 8),
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: buyMapinfo["item_list"].length,
              separatorBuilder: (_, __) => const SizedBox(height: 6),
              itemBuilder: (context, index) {
                final item = buyMapinfo["item_list"][index];
                return Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        (item["item_title"] ?? "").toString(),
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: "Gilroy_Medium",
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Text(
                      "Qty: ${item["quantity"] ?? 1}",
                      style: TextStyle(
                        color: greaycolor,
                        fontFamily: "Gilroy_Medium",
                        fontSize: 12,
                      ),
                    ),
                  ],
                );
              },
            ),
          ],
        ],
      ),
    );
  }

  // ── 8. CONTEXTUAL STATUS CARD ─────────────────────────────────────────────

  final Set<String> _seenTripEvents = <String>{};

  Widget _buildContextualStatusCard() {
    final status = (orderProduc?["Order_Status"] ?? "Processing").toString();
    final s = status.toLowerCase();

    String title = "Processing — Rider is Picking Up Your Order".tr;
    String message = "Your delivery partner is on the way to the pickup location to collect your order.".tr;
    IconData icon = Icons.info_outline_rounded;
    Color accent = linercolor;

    if (s == "completed") {
      title = "Delivered Successfully".tr;
      message = "Your package has been delivered successfully.".tr;
      icon = Icons.check_circle_outline_rounded;
      accent = const Color(0xFF00C853);
    } else if (s == "cancelled") {
      title = "Order Cancelled".tr;
      message = "This order has been cancelled.".tr;
      icon = Icons.cancel_outlined;
      accent = const Color(0xFFFF5252);
    } else if (orderProduc?["trip_progress"]?["arrived_drop"] == true) {
      title = "Driver Arrived at Drop".tr;
      message = "Your driver has reached the drop location. Please receive your goods.".tr;
      icon = Icons.location_on_outlined;
      accent = const Color(0xFFFF9100);
    } else if (s == "on route" || s == "on_route" || s == "intransit") {
      title = "In Transit — On the Way to Drop".tr;
      message = "Your delivery partner is on the way to the drop location.".tr;
      icon = Icons.near_me_outlined;
      accent = const Color(0xFF2979FF);
    } else if (s == "pickup") {
      title = "Rider Arrived at Pickup".tr;
      message = "Share the pickup OTP only after your goods are loaded and handed over. Verifying it starts delivery.".tr;
      icon = Icons.inventory_2_outlined;
      accent = const Color(0xFFFF9100);
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: accent.withOpacity(0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withOpacity(0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: accent, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: notifier.text,
                    fontFamily: "Gilroy_Bold",
                    fontSize: 13.5,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  message,
                  style: TextStyle(
                    color: greaycolor,
                    fontFamily: "Gilroy_Medium",
                    fontSize: 12,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── 9. PAYMENT DETAILS CARD ───────────────────────────────────────────────

  Widget _buildPaymentDetailsCard() {
    final method = (orderProduc?["p_method_name"] ?? orderProduc?["pay_method"] ?? "Cash on Delivery").toString();
    final status = (orderProduc?["Order_Status"] ?? "Processing").toString();
    final statusLower = status.trim().toLowerCase();
    final isCompleted = statusLower == "completed";
    final isCancelled = statusLower == "cancelled" || statusLower == "cancel";
    final packageCat = (orderProduc?["category"] ?? "Standard").toString();
    final deliveryCharge = (orderProduc?["Delivery_charge"] ?? "0").toString();
    final extraMile = (orderProduc?["extra_mile_charge"] ?? "0").toString();
    final discount = (orderProduc?["cou_amt"] ?? "0").toString();

    final rawActualTotal = (orderProduc?["grand_total"] ??
            orderProduc?["total_Delivery_charge"] ??
            buyMapinfo?["grand_total"] ??
            buyMapinfo?["total_Delivery_charge"] ??
            grandTotal ??
            "0")
        .toString();
    double totalDouble = double.tryParse(rawActualTotal) ?? 0.0;

    final rawAdvance = (orderProduc?["advance_payment "] ??
            orderProduc?["advance_payment"] ??
            buyMapinfo?["advance_payment "] ??
            buyMapinfo?["advance_payment"] ??
            "0")
        .toString();
    double advDouble = double.tryParse(rawAdvance) ?? 0.0;
    if (totalDouble == 0.0 && advDouble > 0) {
      totalDouble = advDouble;
    }
    double remainingDouble = (totalDouble - advDouble) > 0 ? (totalDouble - advDouble) : 0.0;

    final totalStr = (totalDouble % 1 == 0) ? totalDouble.toInt().toString() : totalDouble.toStringAsFixed(2);
    final advanceStr = (advDouble % 1 == 0) ? advDouble.toInt().toString() : advDouble.toStringAsFixed(2);
    final remainingStr = (remainingDouble % 1 == 0) ? remainingDouble.toInt().toString() : remainingDouble.toStringAsFixed(2);

    Widget buildRow(String label, String value, {Color? valueColor, bool isBold = false}) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: TextStyle(
                color: greaycolor,
                fontFamily: isBold ? "Gilroy_Bold" : "Gilroy_Medium",
                fontSize: 13,
              ),
            ),
            Text(
              value,
              style: TextStyle(
                color: valueColor ?? notifier.text,
                fontFamily: isBold ? "Gilroy_Bold" : "Gilroy_Medium",
                fontSize: 13,
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: linercolor.withOpacity(0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.account_balance_wallet_outlined, color: linercolor, size: 16),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    "Payment Details".tr,
                    style: TextStyle(
                      color: notifier.text,
                      fontFamily: "Gilroy_Bold",
                      fontSize: 15,
                    ),
                  ),
                ],
              ),
              if (isCompleted) _buildCompactInvoiceButton(),
            ],
          ),
          const SizedBox(height: 12),
          buildRow("Payment Method".tr, method),
          buildRow("Order Status".tr, status),
          buildRow("Package Details".tr, packageCat),
          buildRow("Delivery Fees".tr, "$currency$deliveryCharge"),
          if (extraMile != "0" && extraMile.isNotEmpty)
            buildRow("Extra Mile Charge".tr, "$currency$extraMile"),
          if (discount != "0" && discount.isNotEmpty)
            buildRow("Coupon Discount".tr, "-$currency$discount", valueColor: const Color(0xFF00C853)),
          const SizedBox(height: 8),
          Divider(color: Colors.grey.shade200),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Grand Total".tr,
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: "Gilroy_Bold",
                  fontSize: 16,
                ),
              ),
              Text(
                "$currency$totalStr",
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: "Gilroy_Bold",
                  fontSize: 17,
                ),
              ),
            ],
          ),

          // Advance & Remaining calculation breakdown
          if (advDouble > 0) ...[
            const SizedBox(height: 8),
            Divider(color: Colors.grey.shade200),
            const SizedBox(height: 4),
            buildRow(
              "Advance Paid (Online)".tr,
              "-$currency$advanceStr",
              valueColor: const Color(0xFF00C853),
              isBold: true,
            ),
            buildRow(
              isCompleted
                  ? "Remaining Paid to Rider (Cash)".tr
                  : isCancelled
                      ? "Remaining Amount".tr
                      : "Remaining to Pay Rider (Cash)".tr,
              isCancelled ? "$currency 0" : "$currency$remainingStr",
              valueColor: isCompleted
                  ? const Color(0xFF00C853)
                  : isCancelled
                      ? greaycolor
                      : (remainingDouble > 0 ? const Color(0xFFFF6D00) : notifier.text),
              isBold: true,
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: notifier.lightBgColor,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: notifier.bordecolor.withOpacity(0.5)),
              ),
              child: Row(
                children: [
                  // 1. Advance box
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE8F8EE),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFC8E6C9)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: const [
                              Icon(Icons.check_circle_rounded, color: Color(0xFF00C853), size: 12),
                              SizedBox(width: 4),
                              Text(
                                "Advance Paid",
                                style: TextStyle(
                                  color: Color(0xFF00C853),
                                  fontFamily: "Gilroy_Bold",
                                  fontSize: 10.5,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 3),
                          Text(
                            "$currency$advanceStr",
                            style: const TextStyle(
                              color: Color(0xFF00C853),
                              fontFamily: "Gilroy_Bold",
                              fontSize: 15,
                            ),
                          ),
                          Text(
                            "Paid Online".tr,
                            style: TextStyle(
                              color: Colors.green.shade800,
                              fontFamily: "Gilroy_Medium",
                              fontSize: 9.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // 2. Remaining to Driver box
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: isCompleted
                            ? const Color(0xFFE8F8EE)
                            : isCancelled
                                ? Colors.grey.shade100
                                : const Color(0xFFFFF3E0),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: isCompleted
                              ? const Color(0xFFC8E6C9)
                              : isCancelled
                                  ? Colors.grey.shade300
                                  : const Color(0xFFFFCC80),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                isCompleted
                                    ? Icons.check_circle_rounded
                                    : isCancelled
                                        ? Icons.cancel_outlined
                                        : Icons.payments_outlined,
                                color: isCompleted
                                    ? const Color(0xFF00C853)
                                    : isCancelled
                                        ? Colors.grey.shade600
                                        : const Color(0xFFE65100),
                                size: 12,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                isCompleted
                                    ? "Paid to Rider".tr
                                    : isCancelled
                                        ? "No Due".tr
                                        : "Pay to Rider".tr,
                                style: TextStyle(
                                  color: isCompleted
                                      ? const Color(0xFF00C853)
                                      : isCancelled
                                          ? Colors.grey.shade600
                                          : const Color(0xFFE65100),
                                  fontFamily: "Gilroy_Bold",
                                  fontSize: 10.5,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 3),
                          Text(
                            isCancelled ? "$currency 0" : "$currency$remainingStr",
                            style: TextStyle(
                              color: isCompleted
                                  ? const Color(0xFF00C853)
                                  : isCancelled
                                      ? Colors.grey.shade600
                                      : const Color(0xFFE65100),
                              fontFamily: "Gilroy_Bold",
                              fontSize: 15,
                            ),
                          ),
                          Text(
                            isCompleted
                                ? "Cash Settled".tr
                                : isCancelled
                                    ? "Order Cancelled".tr
                                    : "Cash on delivery".tr,
                            style: TextStyle(
                              color: isCompleted
                                  ? Colors.green.shade800
                                  : isCancelled
                                      ? Colors.grey.shade600
                                      : Colors.deepOrange.shade800,
                              fontFamily: "Gilroy_Medium",
                              fontSize: 9.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ── 10. CASH ON DELIVERY INSTRUCTION CARD ─────────────────────────────────

  Widget _buildCodInstructionCard() {
    final status = (orderProduc?["Order_Status"] ?? "").toString().trim().toLowerCase();
    final isCompleted = status == "completed";
    final isCancelled = status == "cancelled" || status == "cancel";
    final isPaymentPaid = (orderProduc?["payment_status"] ?? "").toString() == "1";

    final rawActualTotal = (orderProduc?["grand_total"] ??
            orderProduc?["total_Delivery_charge"] ??
            buyMapinfo?["grand_total"] ??
            buyMapinfo?["total_Delivery_charge"] ??
            grandTotal ??
            "0")
        .toString();
    double totalDouble = double.tryParse(rawActualTotal) ?? 0.0;

    final rawAdvance = (orderProduc?["advance_payment "] ??
            orderProduc?["advance_payment"] ??
            buyMapinfo?["advance_payment "] ??
            buyMapinfo?["advance_payment"] ??
            "0")
        .toString();
    double advDouble = double.tryParse(rawAdvance) ?? 0.0;
    if (totalDouble == 0.0 && advDouble > 0) {
      totalDouble = advDouble;
    }
    double remainingDouble = (totalDouble - advDouble) > 0 ? (totalDouble - advDouble) : 0.0;

    final totalStr = (totalDouble % 1 == 0) ? totalDouble.toInt().toString() : totalDouble.toStringAsFixed(2);
    final advanceStr = (advDouble % 1 == 0) ? advDouble.toInt().toString() : advDouble.toStringAsFixed(2);
    final remainingStr = (remainingDouble % 1 == 0) ? remainingDouble.toInt().toString() : remainingDouble.toStringAsFixed(2);

    // 1. Completed state
    if (isCompleted) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: const Color(0xFFE8F8EE),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFC8E6C9)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.check_circle_rounded, color: Color(0xFF00C853), size: 24),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Order Completed • Payment Settled".tr,
                    style: const TextStyle(
                      color: Color(0xFF00C853),
                      fontFamily: "Gilroy_Bold",
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 4),
                  if (advDouble > 0 && remainingDouble > 0)
                    Text(
                      "Advance Paid Online: $currency$advanceStr • Cash Paid to Rider: $currency$remainingStr (Total Settled: $currency$totalStr)".tr,
                      style: TextStyle(
                        color: Colors.green.shade800,
                        fontFamily: "Gilroy_Medium",
                        fontSize: 12,
                        height: 1.3,
                      ),
                    )
                  else if (advDouble > 0)
                    Text(
                      "Full amount of $currency$advanceStr was paid online. All payments are completed.".tr,
                      style: TextStyle(
                        color: Colors.green.shade800,
                        fontFamily: "Gilroy_Medium",
                        fontSize: 12,
                        height: 1.3,
                      ),
                    )
                  else
                    Text(
                      "Total payment of $currency$totalStr was successfully settled with the rider.".tr,
                      style: TextStyle(
                        color: Colors.green.shade800,
                        fontFamily: "Gilroy_Medium",
                        fontSize: 12,
                        height: 1.3,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    // 2. Cancelled state
    if (isCancelled) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: advDouble > 0 ? const Color(0xFFFFF8E1) : const Color(0xFFFFEEEE),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: advDouble > 0 ? const Color(0xFFFFE082) : const Color(0xFFFFCDD2)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              advDouble > 0 ? Icons.info_outline_rounded : Icons.cancel_outlined,
              color: advDouble > 0 ? Colors.amber.shade900 : const Color(0xFFFF5252),
              size: 24,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    advDouble > 0 ? "Order Cancelled • Advance Payment Details".tr : "Order Cancelled".tr,
                    style: TextStyle(
                      color: advDouble > 0 ? Colors.amber.shade900 : const Color(0xFFFF5252),
                      fontFamily: "Gilroy_Bold",
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 4),
                  if (advDouble > 0)
                    Text(
                      "Advance paid: $currency$advanceStr. No remaining payment ($currency$remainingStr) is due to the driver. Advance refund will be processed as per policy.".tr,
                      style: TextStyle(
                        color: Colors.brown.shade800,
                        fontFamily: "Gilroy_Medium",
                        fontSize: 12,
                        height: 1.3,
                      ),
                    )
                  else
                    Text(
                      "This order was cancelled. No payment is due.".tr,
                      style: TextStyle(
                        color: Colors.red.shade800,
                        fontFamily: "Gilroy_Medium",
                        fontSize: 12,
                        height: 1.3,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    // 3. Active order with full online payment already complete
    if (isPaymentPaid) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFFE8F8EE),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFC8E6C9)),
        ),
        child: Row(
          children: [
            const Icon(Icons.check_circle_rounded, color: Color(0xFF00C853), size: 22),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Payment Completed Online".tr,
                    style: const TextStyle(
                      color: Color(0xFF00C853),
                      fontFamily: "Gilroy_Bold",
                      fontSize: 13.5,
                    ),
                  ),
                  Text(
                    "No cash payment is required to the rider.".tr,
                    style: TextStyle(
                      color: Colors.green.shade800,
                      fontFamily: "Gilroy_Medium",
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    // 4. Active order - Cash on delivery or remaining amount
    final method = (orderProduc?["p_method_name"] ?? orderProduc?["pay_method"] ?? "").toString().toLowerCase();
    final isCod = method.contains("cash") || method.contains("cod") || method.isEmpty || remainingDouble > 0;

    if (!isCod) return const SizedBox();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFFE3D3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: linercolor.withOpacity(0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.payments_outlined, color: linercolor, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  advDouble > 0
                      ? "Pay remaining $currency$remainingStr in cash to rider".tr
                      : "Pay $currency$totalStr in cash to rider".tr,
                  style: TextStyle(
                    color: notifier.text,
                    fontFamily: "Gilroy_Bold",
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  advDouble > 0
                      ? "Advance of $currency$advanceStr has been paid online. Hand over the remaining $currency$remainingStr to the rider upon delivery.".tr
                      : "Have the exact amount ready for a smoother delivery experience.".tr,
                  style: TextStyle(
                    color: greaycolor,
                    fontFamily: "Gilroy_Medium",
                    fontSize: 11.5,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── 10B. COMPACT INVOICE BUTTON ──────────────────────────────────────────

  Widget _buildCompactInvoiceButton() {
    if (widget.type != "Pickup") return const SizedBox();
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: isInvoiceLoading ? null : () => downloadInvoice(),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFE8F8EE),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFF00C853).withOpacity(0.4), width: 1.2),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (isInvoiceLoading)
                const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF00C853)),
                )
              else
                const Icon(Icons.receipt_long_rounded, size: 16, color: Color(0xFF00C853)),
              const SizedBox(width: 5),
              Text(
                isInvoiceLoading ? "Please wait...".tr : "Invoice".tr,
                style: const TextStyle(
                  color: Color(0xFF00C853),
                  fontFamily: "Gilroy_Bold",
                  fontSize: 12.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── 11. BOTTOM ACTION BUTTONS (CANCEL / REVIEW / INVOICE) ──────────────────

  Widget _buildBottomActionButtons() {
    final status = (orderProduc?["Order_Status"] ?? "").toString();
    final statusLower = status.trim().toLowerCase();

    // 1. Completed state actions: Prominently show Final Amount with compact side invoice button
    if (statusLower == "completed") {
      final rawActualTotal = (orderProduc?["grand_total"] ??
              orderProduc?["total_Delivery_charge"] ??
              buyMapinfo?["grand_total"] ??
              buyMapinfo?["total_Delivery_charge"] ??
              grandTotal ??
              "0")
          .toString();
      double totalDouble = double.tryParse(rawActualTotal) ?? 0.0;

      final rawAdvance = (orderProduc?["advance_payment "] ??
              orderProduc?["advance_payment"] ??
              buyMapinfo?["advance_payment "] ??
              buyMapinfo?["advance_payment"] ??
              "0")
          .toString();
      double advDouble = double.tryParse(rawAdvance) ?? 0.0;
      if (totalDouble == 0.0 && advDouble > 0) {
        totalDouble = advDouble;
      }
      final totalStr = (totalDouble % 1 == 0) ? totalDouble.toInt().toString() : totalDouble.toStringAsFixed(2);

      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (orderProduc?["is_rate"] == "0") ...[
            appButton1(
              tital: "Order Review".tr,
              buttonbgColor: linercolor,
              bordecolor: linercolor,
              onTap: () {
                commit.clear();
                reviewRider();
              },
            ),
            const SizedBox(height: 12),
          ],
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: notifier.getBgColor,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.04),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          "Final Amount".tr,
                          style: TextStyle(
                            color: greaycolor,
                            fontFamily: "Gilroy_Medium",
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE8F8EE),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: const [
                              Icon(Icons.check_circle_rounded, color: Color(0xFF00C853), size: 10),
                              SizedBox(width: 3),
                              Text(
                                "Paid",
                                style: TextStyle(
                                  color: Color(0xFF00C853),
                                  fontFamily: "Gilroy_Bold",
                                  fontSize: 10,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      "$currency$totalStr",
                      style: TextStyle(
                        color: notifier.text,
                        fontFamily: "Gilroy_Bold",
                        fontSize: 20,
                      ),
                    ),
                  ],
                ),
                _buildCompactInvoiceButton(),
              ],
            ),
          ),
        ],
      );
    }

    // 2. Cancelled state
    if (status == "Cancelled") return const SizedBox();

    // 3. Buy Anything order step 6 pay advance
    if (widget.type != "Pickup" && buyMapinfo != null && buyMapinfo["order_step"] == 6) {
      return Column(
        children: [
          appButton1(
            bordecolor: greencolor,
            buttonbgColor: greencolor,
            tital: "${"PAY".tr} $currency$grandTotal",
            onTap: () => _payAdvanceWithRazorpay(grandTotal.toString()),
          ),
          const SizedBox(height: 10),
          _buildCancelButton(),
        ],
      );
    }

    // 4. Default active order cancel button
    return _buildCancelButton();
  }

  Widget _buildCancelButton() {
    final cancelOrderId = buyMapinfo?["order_id"] ?? orderid;
    return SizedBox(
      width: double.infinity,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => dialogShow(cancelOrderId),
          borderRadius: BorderRadius.circular(16),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: BoxDecoration(
              color: const Color(0xFFFF5252),
              borderRadius: BorderRadius.circular(16),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFFF5252).withOpacity(0.25),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: const [
                Icon(Icons.cancel_outlined, color: Colors.white, size: 20),
                SizedBox(width: 8),
                Text(
                  "Cancel Order",
                  style: TextStyle(
                    color: Colors.white,
                    fontFamily: "Gilroy_Bold",
                    fontSize: 15,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── 12. SKELETON & ERROR LOADERS ──────────────────────────────────────────

  Widget _buildSkeletonLoader() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Container(
            height: 80,
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(20),
            ),
          ),
          const SizedBox(height: 14),
          Container(
            height: 90,
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(20),
            ),
          ),
          const SizedBox(height: 14),
          Container(
            height: 200,
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(20),
            ),
          ),
          const SizedBox(height: 14),
          Container(
            height: 70,
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(20),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline_rounded, size: 48, color: linercolor),
            const SizedBox(height: 12),
            Text(
              "Unable to load order details".tr,
              style: TextStyle(
                color: notifier.text,
                fontFamily: "Gilroy_Bold",
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              "Please check your connection and try again.".tr,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: greaycolor,
                fontFamily: "Gilroy_Medium",
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => pageRefresh(),
              style: ElevatedButton.styleFrom(
                backgroundColor: linercolor,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text("Retry".tr, style: const TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );
  }

  // ── MAIN CONTENT (OPTIMIZED SCROLLING & ZERO JANK) ───────────────────────

  Widget _buildMainContent(BuildContext context) {
    final status = (orderProduc?["Order_Status"] ?? "").toString().trim().toLowerCase();
    final isFinished = status == "completed" || status == "cancelled" || status == "cancel";

    Widget content = SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      physics: const BouncingScrollPhysics(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildOrderSummaryCard(),
          const SizedBox(height: 14),
          _buildStatusTimeline(),
          const SizedBox(height: 14),
          if (!isFinished) ...[
            RepaintBoundary(child: _buildLiveTrackingCard()),
            const SizedBox(height: 14),
          ],
          _buildQuickOrderInfo(),
          const SizedBox(height: 14),
          _buildOtpAndRiderSection(),
          const SizedBox(height: 14),
          if (_hasPackageInfo()) ...[
            _buildPackageInfoCard(),
            const SizedBox(height: 14),
          ],
          _buildContextualStatusCard(),
          const SizedBox(height: 14),
          _buildPaymentDetailsCard(),
          const SizedBox(height: 14),
          _buildCodInstructionCard(),
          const SizedBox(height: 20),
          _buildBottomActionButtons(),
          SizedBox(height: MediaQuery.of(context).padding.bottom + 20),
        ],
      ),
    );

    if (_isAdvancePaymentRequiredForOrder) {
      return ImageFiltered(
        imageFilter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: IgnorePointer(
          ignoring: true,
          child: content,
        ),
      );
    }
    return content;
  }

  // ── MAIN BUILD METHOD ─────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);

    return WillPopScope(
      onWillPop: () async {
        if (orderProduc != null &&
            (orderProduc["payment_status"] ?? "").toString() != "1" &&
            _isAdvancePaymentRequiredForOrder) {
          return false;
        }
        if (orderProduc != null && orderProduc["Order_Status"] == "Completed") {
          if (widget.isback == true) {
            Get.back();
          } else {
            Get.offAll(() => Bottombar());
          }
        } else {
          Get.back();
        }
        return true;
      },
      child: Scaffold(
        backgroundColor: linercolor,
        body: Column(
          children: [
            _buildModernHeader(),
            const SocketStatusBanner(),
            Expanded(
              child: Container(
                width: double.infinity,
                decoration: BoxDecoration(
                  color: notifier.lightBgColor,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(28),
                    topRight: Radius.circular(28),
                  ),
                ),
                child: ClipRRect(
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(28),
                    topRight: Radius.circular(28),
                  ),
                  child: isLoading && orderProduc == null
                      ? _buildSkeletonLoader()
                      : orderProduc == null
                          ? _buildErrorState()
                          : _buildMainContent(context),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future reviewRider() {
    notifier = Provider.of(context, listen: false);
    return showModalBottomSheet(
      isDismissible: true,
      barrierColor: notifier.text.withOpacity(0.3),
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      backgroundColor: notifier.lightBgColor,
      context: context,
      builder: (context) {
        return Padding(
          padding: EdgeInsets.all(15),
          child: StatefulBuilder(
            builder: (BuildContext context, StateSetter setState) {
              return Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: SizedBox(
                        width: Get.width / 1.5,
                        child: Text(
                          "Please submit review for delivery boy".tr,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          style: TextStyle(
                            fontSize: 23,
                            color: notifier.text,
                            fontFamily: "Gilroy_Bold",
                          ),
                        ),
                      ),
                    ),
                    SizedBox(height: 10),
                    Center(
                      child: RatingBar.builder(
                        unratedColor: lightgrey,
                        initialRating: (riderrate <= 0 ? 5 : riderrate).toDouble(),
                        minRating: 1,
                        direction: Axis.horizontal,
                        itemCount: 5,
                        glowColor: greaycolor,
                        itemPadding: EdgeInsets.symmetric(horizontal: 4.0),
                        itemBuilder: (context, _) => Icon(
                          Icons.star,
                          color: linercolor,
                          size: 20,
                        ),
                        onRatingUpdate: (rating) {
                          riderrate = rating.ceil();
                        },
                      ),
                    ),
                    SizedBox(height: 10),
                    Text(
                      "${"Comment".tr} (${"Optional".tr})",
                      style: TextStyle(
                        fontSize: 15,
                        fontFamily: "Gilroy_Bold",
                        color: notifier.text,
                      ),
                    ),
                    SizedBox(height: 4),
                    textfild(
                      controller: commit,
                      hintText: "Enter comment (optional)".tr,
                    ),
                    SizedBox(height: 20),
                    SizedBox(
                      width: Get.width,
                      child: appButton(
                        tital: "Submit".tr,
                        onTap: () {
                          if (riderrate <= 0) {
                            riderrate = 5;
                          }
                          isRating();
                        },
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );
  }

  Widget itemlist(item, i) {
    return Container(
      width: Get.width / 2.4,
      padding: EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: notifier.getBgColor,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          item[i]["item_img"][0] != null && item[i]["item_img"][0] != ""
              ? ClipRRect(
            borderRadius: BorderRadius.circular(13),
            child: FadeInImage(
              height: 150,
              width: Get.width / 2.5,
              placeholder: AssetImage("assets/ezgif.com-crop.gif"),
              image: NetworkImage(
                Config.resolveImageUrl(item[i]["item_img"][0]?.toString()),
              ),
              fit: BoxFit.cover,
            ),
          )
              : Container(),
          SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Item".tr,
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: 'Gilroy_Bold',
                ),
              ),
              Text(
                "Qty".tr,
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: 'Gilroy_Bold',
                ),
              ),
            ],
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  item[i]["item_title"],
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: 'Gilroy_Medium',
                    color: greaycolor,
                  ),
                ),
              ),
              Text(
                "${item[i]["quantity"]}",
                style: TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  color: greaycolor,
                ),
              ),
            ],
          ),
          Divider(color: lightgrey),
          item[i]["item_total"] != null
              ? Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Total".tr,
                style: TextStyle(
                  color: notifier.text,
                  fontFamily: 'Gilroy_Bold',
                ),
              ),
              Text(
                "$currency${item[i]["item_total"] ?? "0"}",
                style: TextStyle(
                  fontFamily: 'Gilroy_Medium',
                  color: greaycolor,
                ),
              ),
            ],
          )
              : const SizedBox(height: 0),
          SizedBox(height: 10),
          item[i]["item_confirm"] != "2"
              ? InkWell(
            onTap: () {
              Get.to(
                    () => TrakingView(
                  itemlength: buyMapinfo["item_list"].length.toString(),
                  imageList: item[i]["item_img"],
                  itemID: item[i]["item_id"],
                  type: item[i]["item_confirm"],
                ),
              )!.then((value) {
                setState(() {});
                buyMapinfoget();
              });
            },
            child: Container(
              padding: EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                color: item[i]["item_confirm"] != "0"
                    ? greencolor
                    : linercolor,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Center(
                child: Text(
                  item[i]["item_confirm"] != "0"
                      ? "Option Confirm".tr
                      : "View Option".tr,
                  style: TextStyle(
                    fontSize: Get.height / 50,
                    color: whitecolor,
                    fontFamily: 'Gilroy_Medium',
                  ),
                ),
              ),
            ),
          )
              : InkWell(
            //!  --------------  Item Canceled  -------------
            onTap: () {
              var contain = buyMapinfo["item_list"]
                  .where((element) => element["item_confirm"] == "2");
              if (contain.length == buyMapinfo["item_list"].length) {
                dialogShow(item[i]["item_id"]);
              } else {
                itemConfirm(item[i]["item_id"]);
              }
            },
            child: Container(
              height: Get.height * 0.045,
              width: Get.width / 2.8,
              decoration: BoxDecoration(
                color: orangecolor,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Center(
                child: Text(
                  "Item Cancle".tr,
                  style: TextStyle(
                    fontSize: Get.height / 50,
                    color: whitecolor,
                    fontFamily: 'Gilroy_Medium',
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget oderDetailsText({required String title, required String subtitle}) {
    return SizedBox(
      width: Get.width / 2.5,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: greaycolor,
              fontSize: 13,
              fontFamily: 'Gilroy_Medium',
            ),
          ),
          Text(
            subtitle,
            style: TextStyle(
              color: notifier.text,
              fontSize: 15,
              fontFamily: 'Gilroy_Bold',
            ),
          ),
        ],
      ),
    );
  }

  Widget attachment(image, i) {
    return InkWell(
      onTap: () {
        Get.to(() => TrakingView(imageList: image, type: "1"));
      },
      child: Container(
        width: 100,
        decoration: BoxDecoration(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: FadeInImage(
            placeholder: AssetImage("assets/ezgif.com-crop.gif"),
            image: NetworkImage(Config.resolveImageUrl(image[i]?.toString())),
            fit: BoxFit.cover,
          ),
        ),
      ),
    );
  }

  Widget locations({
    String? imgs,
    String? currentaddressname,
    String? addresses,
  }) {
    return Row(
      children: [
        Image.asset(imgs!, height: Get.height / 30),
        SizedBox(width: Get.width / 40),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Ink(
              width: Get.width * 0.75,
              child: Text(
                currentaddressname!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: blackcolor,
                  fontFamily: 'Gilroy_Bold',
                  fontSize: Get.height / 52,
                ),
              ),
            ),
            Ink(
              width: Get.width * 0.75,
              child: Text(
                addresses!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: greaycolor.withOpacity(0.8),
                  fontFamily: 'Gilroy_Bold',
                  fontSize: Get.height / 60,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }


  Widget otpHighlightCard(String otp) {
    return Container(
      width: Get.width,
      padding: EdgeInsets.symmetric(horizontal: 15, vertical: 14),
      decoration: BoxDecoration(
        color: linercolor.withOpacity(0.08),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: linercolor.withOpacity(0.5),
          width: 1.4,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Icon(Icons.lock_clock_rounded, color: linercolor, size: 22),
              SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Your OTP".tr,
                    style: TextStyle(
                      color: greaycolor,
                      fontSize: 12,
                      fontFamily: 'Gilroy_Medium',
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    otp,
                    style: TextStyle(
                      color: linercolor,
                      fontSize: 22,
                      letterSpacing: 4,
                      fontFamily: 'Gilroy_Bold',
                    ),
                  ),
                ],
              ),
            ],
          ),
          InkWell(
            onTap: () {
              Clipboard.setData(ClipboardData(text: otp));
              ApiWrapper.showToastMessage("OTP Copied".tr);
            },
            child: Container(
              padding: EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: linercolor.withOpacity(0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.copy_rounded, color: linercolor, size: 18),
            ),
          ),
        ],
      ),
    );
  }

  deliverydistance({
    String? title,
    Color? color,
    Color? bgcolor,
    Color? iconColor,
  }) {
    return Container(
      // height: height * 0.08,
      // width: width / 1.1,
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(13),
        color: bgcolor,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(Icons.info, color: iconColor),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              title ?? "",
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontFamily: 'Gilroy_Medium',
                fontSize: 18,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }

  pkgOrder() {
    isLoading = true;
    var data = {"uid": uid, "order_id": orderid};
    ApiWrapper.dataPostNode(Config.nodeOrderDetails, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          setState(() {});
          val["OrderProductList"].forEach((e) => orderProduc = e);
          _seedDriverPositionFromOrder(orderProduc);
          oderStatusColor();
          isLoading = false;
          setState(() {});
          checkAdvancePaymentStatus();
        }
      }
    });
  }

  buyorderDetail() {
    isLoading = true;
    var data = {"uid": uid, "order_id": orderid};
    log(data.toString(), name: "data Api");
    ApiWrapper.dataPostNode(Config.nodeBuyOrderDetail, data).then((val) {
      log(val.toString(), name: "Api Response");
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          log(val["BuyOrderProductList"].toString(), name: "Buy Order data");
          val["BuyOrderProductList"].forEach((e) => orderProduc = e);
          _seedDriverPositionFromOrder(orderProduc);
          oderStatusColor();
          isLoading = false;
          setState(() {});
          checkAdvancePaymentStatus();
        }
      }
    });
  }

  isRating() {
    if (widget.type == "Pickup") {
      // Dispatch/pkg_order flow — goes to Node's /api/order/rate, which
      // (unlike the legacy pkg_rate.php) needs rider_id explicitly.
      var data = {
        "uid": int.tryParse(uid.toString()) ?? 0,
        "order_id": int.tryParse(orderid.toString()) ?? 0,
        "rider_id": int.tryParse((orderProduc?["rider_id"] ?? "0").toString()) ?? 0,
        "star": riderrate,
        "comment": commit.text.trim(),
      };
      ApiWrapper.dataPostNode(Config.nodeOrderRate, data).then((val) {
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
            Get.back();
            Get.back();
            ApiWrapper.showToastMessage(val["ResponseMsg"]);
            setState(() {});
          } else {
            ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Failed to submit rating".tr);
          }
        }
      });
      return;
    }

    var data = {
      "uid": uid,
      "rate": "$riderrate",
      "order_id": orderid,
      "comment": commit.text.trim()
    };
    ApiWrapper.dataPostNode(Config.nodeBuyRate, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          Get.back();
          Get.back();
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
          setState(() {});
        }
      }
    });
  }

  Future<void> toggleFavoriteDriver() async {
    if (orderProduc == null || orderProduc["rider_id"] == null) return;
    setState(() => isFavoriteLoading = true);
    var data = {
      "user_id": uid,
      "rider_id": "${orderProduc["rider_id"]}",
    };
    try {
      final val = await ApiWrapper.dataPostNode(Config.nodeFavoritesToggle, data);
      if (val != null && val.isNotEmpty) {
        if (val["Result"] == true) {
          setState(() {
            isFavorite = val["status"] == 1;
          });
          ApiWrapper.showToastMessage(val["msg"] ?? "");
        }
      }
    } catch (e) {
      debugPrint("toggleFavoriteDriver error: $e");
    } finally {
      setState(() => isFavoriteLoading = false);
    }
  }

  oderStatusColor() {
    switch (orderProduc["Order_Status"]) {
      case "Pending":
        statusColor = const Color(0xffFFC96E);
        break;
      case "Processing":
        statusColor = notifier.darklinercolor;
        break;
      case "On Route":
        statusColor = const Color(0xff00D261);
        break;
      case "Cancelled":
        statusColor = const Color(0xffF44336);
        break;
      case "Completed":
        statusColor = const Color(0xff00D261);
        break;
      default:
    }
  }

  buyMapinfoget() {
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {"orderid": orderid};

    debugPrint("========== buymapinfo url ============ ${Config.nodeBaseUrl}/${Config.nodeBuyMapInfo}");
    debugPrint("========== buymapinfo data =========== $data");
    ApiWrapper.dataPostNode(Config.nodeBuyMapInfo, data).then(
          (val) {
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
            log(val["BuyMapinfo"].toString(), name: "BuyMapinfo : ");
            buyMapinfo = val["BuyMapinfo"];
            setState(() {});
            buyMapinfo["item_list"].forEach((e) {
              if (e["item_confirm"] == "1") {
                payshow = true;
                setState(() {});
              } else {
                setState(() {});
                payshow = false;
              }
            });
            grandTotal = double.parse("${buyMapinfo["service_bill"]}") + double.parse("${buyMapinfo["service_charge"]}");
            setState(() {
              isLoading = false;
            });
          } else {
            setState(() {
              isLoading = false;
            });
          }
        }
      },
    );
  }

  void itemConfirm(itemID) {
    var uid = getdata.read("Uid") ?? "";
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {
      "uid": uid,
      "itmeid": itemID,
      "order_id": orderid,
      "status": "3"
    };
    ApiWrapper.dataPostNode(Config.nodeConfirmItem, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          log(val.toString(), name: "Item Confirm : ");
          buyMapinfoget();
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
        }
      }
    });
  }

  dialogShow(itemID) {
    String selectedReason = "";
    bool isOtherSelected = false;
    TextEditingController otherController = TextEditingController();
    List reasonList = [];
    bool isLoadingReasons = true;
    bool hasFetched = false;

    return showDialog(
      barrierDismissible: false,
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setStateDialog) {
            if (!hasFetched) {
              hasFetched = true;
              ApiWrapper.dataPostNode(Config.nodeCancelReasons, {"type": "user"}).then((val) {
                if (val != null && val['ResponseCode'] == "200" && val['reason_list'] != null) {
                  reasonList = val['reason_list'];
                }
                isLoadingReasons = false;
                setStateDialog(() {});
              });
            }

            return Dialog(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
              ),
              backgroundColor: notifier.getBgColor,
              child: Container(
                width: Get.width * 0.9,
                padding: EdgeInsets.all(15),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "Cancel Order".tr,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 18,
                        ),
                      ),
                      SizedBox(height: 10),
                      Text(
                        "This will lead to cancellation of the order (cancellation charges may apply), Do you want to proceed ?".tr,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 14,
                        ),
                      ),
                      SizedBox(height: 15),
                      if (isLoadingReasons)
                        Center(
                          child: Padding(
                            padding: EdgeInsets.symmetric(vertical: 20),
                            child: CircularProgressIndicator(color: linercolor),
                          ),
                        )
                      else ...[
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ...reasonList.map((item) {
                              String rText = item["reason"] ?? "";
                              return RadioListTile<String>(
                                contentPadding: EdgeInsets.zero,
                                dense: true,
                                title: Text(
                                  rText,
                                  style: TextStyle(
                                    color: notifier.text,
                                    fontFamily: 'Gilroy_Medium',
                                    fontSize: 14,
                                  ),
                                ),
                                activeColor: linercolor,
                                value: rText,
                                groupValue: isOtherSelected ? null : selectedReason,
                                onChanged: (val) {
                                  setStateDialog(() {
                                    isOtherSelected = false;
                                    selectedReason = val ?? "";
                                  });
                                },
                              );
                            }),
                            RadioListTile<String>(
                              contentPadding: EdgeInsets.zero,
                              dense: true,
                              title: Text(
                                "Other".tr,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 14,
                                ),
                              ),
                              activeColor: linercolor,
                              value: "Other",
                              groupValue: isOtherSelected ? "Other" : null,
                              onChanged: (val) {
                                setStateDialog(() {
                                  isOtherSelected = true;
                                  selectedReason = "Other";
                                });
                              },
                            ),
                          ],
                        ),
                        if (isOtherSelected) ...[
                          SizedBox(height: 8),
                          textfild(
                            controller: otherController,
                            hintText: "Enter your reason".tr,
                          ),
                          SizedBox(height: 10),
                        ],
                      ],
                      SizedBox(height: 15),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          InkWell(
                            onTap: () {
                              Get.back();
                            },
                            child: Container(
                              padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: notifier.isDark
                                      ? notifier.bordecolor
                                      : notifier.darklinercolor,
                                ),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                "No".tr,
                                style: TextStyle(
                                  color: notifier.isDark ? greaycolor : notifier.darklinercolor,
                                  fontFamily: "Gilroy_Bold",
                                ),
                              ),
                            ),
                          ),
                          SizedBox(width: 10),
                          InkWell(
                            onTap: () {
                              String finalReason = isOtherSelected
                                  ? otherController.text.trim()
                                  : selectedReason;

                              if (finalReason.isEmpty) {
                                ApiWrapper.showToastMessage("Please select or enter a cancellation reason".tr);
                                return;
                              }

                              Get.back();

                              if (widget.type != "Pickup") {
                                if (buyMapinfo["order_step"] == 0) {
                                  buyCancelOrder(comment: finalReason);
                                } else {
                                  if (orderProduc["item_list"] == "1") {
                                    alertDialogShow(itemID, comment: finalReason);
                                  } else {
                                    buyCancelItem(itemID: itemID, comment: finalReason);
                                  }
                                }
                              } else {
                                pksCancleOrder(comment: finalReason);
                              }
                            },
                            child: Container(
                              padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                              decoration: BoxDecoration(
                                color: linercolor,
                                border: Border.all(color: linercolor),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                "Yes".tr,
                                style: TextStyle(
                                  color: whitecolor,
                                  fontFamily: "Gilroy_Bold",
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }

  //! ------------ item Order Canceled -------------
  buyCancelOrder({String? comment}) {
    var uid = getdata.read("Uid") ?? "";
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {
      "uid": uid,
      "order_id": orderid,
      "comment": comment ?? "",
    };
    ApiWrapper.dataPostNode(Config.nodeBuyCancel, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          log(val.toString(), name: "BuyMapinfo : ");
          Get.off(() => Bottombar());
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
        }
      }
    });
  }

  pksCancleOrder({String? comment}) {
    var uid = getdata.read("Uid") ?? "";
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {
      "uid": int.tryParse(uid.toString()) ?? 0,
      "order_id": int.tryParse(orderid.toString()) ?? 0,
      "comment": comment ?? "",
    };
    // This is the dispatch/pkg_order flow — goes to Node, not pks_cancle.php.
    ApiWrapper.dataPostNode(Config.nodeOrderCancel, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          log(val.toString(), name: "NodeCancel : ");
          Get.off(() => Bottombar());
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
        } else {
          ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Failed to cancel order".tr);
        }
      }
    });
  }

  buyCancelItem({required String itemID, String? comment}) {
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {
      "itmeid": itemID,
      "order_id": orderid,
      "comment": comment ?? "",
    };
    debugPrint("========== data ========= $data");
    ApiWrapper.dataPostNode(Config.nodeItemRemove, data).then(
      (val) {
        if ((val != null) && (val.isNotEmpty)) {
          if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
            log(val.toString(), name: "BuyMapinfo : ");
            if (buyMapinfo["item_list"].length == "1") {
              Get.offAll(Bottombar());
            } else {
              buyorderDetail();
              buyMapinfoget();
              Get.back();
            }
            ApiWrapper.showToastMessage(val["ResponseMsg"]);
          }
        }
      },
    );
  }

  alertDialogShow(itemID, {String? comment}) {
    return showDialog(
      barrierDismissible: false,
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          backgroundColor: notifier.getBgColor,
          content: Text(
            "If you cancel this last item, the whole order will be cancelled. Do you want to proceed?".tr,
            style: TextStyle(
              color: notifier.text,
              fontFamily: 'Gilroy_Medium',
              fontSize: 15,
            ),
          ),
          actions: <Widget>[
            InkWell(
              onTap: () {
                buyCancelItem(itemID: itemID, comment: comment);
              },
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                decoration: BoxDecoration(
                  color: linercolor,
                  border: Border.all(color: linercolor),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  "Yes".tr,
                  style: TextStyle(
                    color: whitecolor,
                    fontFamily: "Gilroy_Bold",
                  ),
                ),
              ),
            ),
            InkWell(
              onTap: () {
                Get.back();
              },
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                decoration: BoxDecoration(
                  border: Border.all(
                    color: notifier.isDark
                        ? notifier.bordecolor
                        : notifier.darklinercolor,
                  ),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  "No".tr,
                  style: TextStyle(
                    color: notifier.isDark ? greaycolor : notifier.darklinercolor,
                    fontFamily: "Gilroy_Bold",
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Future paymentSheet() {
    int paymentindex = 0;
    return showModalBottomSheet(
      isScrollControlled: true,
      backgroundColor: notifier.lightBgColor,
      barrierColor: notifier.text.withOpacity(0.3),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      context: context,
      builder: (context) {
        return Container(
          padding: EdgeInsets.all(10),
          constraints: BoxConstraints(maxHeight: Get.height / 1.5),
          child: Scaffold(
            backgroundColor: notifier.lightBgColor,
            floatingActionButtonLocation:
            FloatingActionButtonLocation.centerDocked,
            floatingActionButton: InkWell(
              onTap: () {
                // ! ------------ Order Api Call -----------
                if (paymenttital != "" && paymenttital != null) {
                  if (isPaymentLoding == false) {
                    setState(() {
                      isPaymentLoding = true;
                    });
                    if (paymenttital == "Razorpay") {
                      debugPrint("Razorpay");
                      debugPrint("--------- key ---------- ${paymentGatwayApiModel!.data![0].attributes}");
                      debugPrint("-------- amount -------- $grandTotal");
                      debugPrint("-------- number -------- ${getdata.read("UserLogin")["mobile"]}");
                      debugPrint("--------- name --------- ${getdata.read("UserLogin")["name"]}");
                      Get.back();
                      razorPayClass.openCheckout(
                        key: "rzp_test_Rr8n8p41taq6fM", // Live Razorpay key ID
                        amount: "$grandTotal",
                        number: "${getdata.read("UserLogin")["mobile"]}",
                        name: "${getdata.read("UserLogin")["name"]}",
                      );
                    } else if (paymenttital == "Paypal") {
                      debugPrint("paypal");
                      List ids = paymentGatwayApiModel!.data![paymentindex].attributes.toString().split(",");
                      debugPrint('++++++++++ ids :------ $ids');
                      paypalPayment(
                        context: context,
                        amt: "$grandTotal",
                        clientId: ids[0],
                        secretKey: ids[1],
                        function: (e) {
                          debugPrint("----------- transactionId ---------- ${e["paymentId"]}");
                          billPayApi("${e["paymentId"]}");
                        },
                      );
                    } else if (paymenttital == "Stripe") {
                      debugPrint("Stripe");
                      //!------------- Stripe Payment ----------
                      Get.back();
                      stripePayment();
                    } else if (paymenttital == "FlutterWave") {
                      debugPrint("FlutterWave");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.flutterwave}amt=$grandTotal&email=${getdata.read("UserLogin")["email"]}",
                        status1: "status",
                        status2: "successful",
                        tId: "transaction_id",
                      );
                    } else if (paymenttital == "Paytm") {
                      debugPrint("Paytm");
                      webViewPaymentMethod(
                        initialUrl:  "${Config.imageURLPath + Config.paytm}amt=$grandTotal&uid=${getdata.read("Uid")}&mobile=${getdata.read("UserLogin")["mobile"]}&email=${getdata.read("UserLogin")["email"]}",
                        status1: "status",
                        status2: "successful",
                        tId: "transaction_id",
                      );
                    } else if (paymenttital == "SenangPay") {
                      debugPrint("SenangPay");
                      final notificationId = UniqueKey().hashCode;
                      webViewPaymentMethod(
                          initialUrl: "${Config.imageURLPath + Config.senangPay}detail=Movers&amount=$grandTotal&order_id=$notificationId&name=${getdata.read("UserLogin")["name"]}&email=${getdata.read("UserLogin")["email"]}&phone=${getdata.read("UserLogin")["mobile"]}",
                          status1: "msg",
                          status2: "Payment_was_successful",
                          tId: "transaction_id");
                    } else if (paymenttital == "PayStack") {
                      debugPrint("PayStack");
                      payStackPaymentApi(
                        email: "${getdata.read("UserLogin")["email"]}",
                        amount: "$grandTotal",
                      ).then((value) {
                        debugPrint("========= value ========= $value");
                        if (value["status"] == true) {
                          debugPrint("--------- authorization_url --------- ${value["data"]["authorization_url"]}");
                          webViewPaymentMethod(
                            initialUrl: "${value["data"]["authorization_url"]}",
                            status1: "status",
                            status2: "success",
                            tId: "trxref",
                          );
                        }
                      });
                    } else if (paymenttital == "MercadoPago") {
                      debugPrint("MercadoPago");
                      webViewPaymentMethod(
                        initialUrl: "${Config.imageURLPath + Config.merpago}amt=$grandTotal",
                        status1: "status",
                        status2: "successful",
                        tId: "",
                      );
                    } else if (paymenttital == "Payfast") {
                      debugPrint("Payfast");
                      webViewPaymentMethod(
                          initialUrl: "${Config.imageURLPath + Config.payFast}amt=$grandTotal",
                          status1: "status",
                          status2: "success",
                          tId: "payment_id");
                    } else if (paymenttital == "Midtrans") {
                      debugPrint("Midtrans");
                      webViewPaymentMethod(
                          initialUrl: "${Config.imageURLPath + Config.midtans}name=${getdata.read("UserLogin")["name"]}&email=${getdata.read("UserLogin")["email"]}&phone=${getdata.read("UserLogin")["mobile"]}&amt=$grandTotal",
                          status1: "status_code",
                          status2: "200",
                          tId: "order_id");
                    } else if (paymenttital == "2checkout") {
                      debugPrint("2checkout");
                      webViewPaymentMethod(
                          initialUrl: "${Config.imageURLPath + Config.checkout2}amt=$grandTotal",
                          status1: "status",
                          status2: "successful",
                          tId: "");
                    } else if (paymenttital == "Khalti Payment") {
                      debugPrint("Khalti Payment");
                      webViewPaymentMethod(
                          initialUrl: "${Config.imageURLPath + Config.khalti}amt=$grandTotal",
                          status1: "status",
                          status2: "Completed",
                          tId: "transaction_id");
                    }
                  }
                } else {
                  tostmsg("Select Your Payment Method");
                }
              },
              child: isPaymentLoding
                  ? Container(
                width: Get.width,
                height: Get.height / 16,
                decoration: BoxDecoration(
                  color: linercolor,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Center(
                  child:
                  SpinKitThreeBounce(color: whitecolor, size: 25.0),
                ),
              )
                  : Container(
                height: 50,
                width: Get.width,
                decoration: BoxDecoration(
                  color: linercolor,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Center(
                  child: Text(
                    "${"PAY NOW".tr} | $currency$grandTotal",
                    style: TextStyle(
                      color: whitecolor,
                      fontSize: Get.height / 50,
                      fontFamily: 'Gilroy_Medium',
                    ),
                  ),
                ),
              ),
            ),
            body: StatefulBuilder(builder: (context, setState) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Select Payment Method".tr,
                    style: TextStyle(
                        fontSize: 20,
                        fontFamily: 'Gilroy_Bold',
                        color: notifier.text),
                  ),
                  SizedBox(height: 10),
                  //! --------- List view paymente ----------
                  Expanded(
                    child: ListView.separated(
                      shrinkWrap: true,
                      padding: EdgeInsets.only(bottom: 50),
                      physics: BouncingScrollPhysics(),
                      itemCount: paymentGatwayApiModel!.data!.length,
                      itemBuilder: (context, index) {
                        return paymentGatwayApiModel!.data![index].pShow == "0"
                            ? SizedBox()
                            : InkWell(
                          onTap: () {
                            setState(() {
                              paymenttital = paymentGatwayApiModel!.data![index].title;
                              paymentindex = index;
                              _groupValue = int.parse(
                                  "${paymentGatwayApiModel!.data![index].id}");
                            });
                            debugPrint( "============ groupValue ============ $_groupValue");
                            debugPrint("=========== paymentindex =========== $paymentindex");
                          },
                          child: Container(
                            padding: EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              border: Border.all(
                                color: _groupValue == int.parse("${paymentGatwayApiModel!.data![index].id}")
                                    ? notifier.darklinercolor
                                    : Colors.transparent,
                                width: 1,
                              ),
                              color: notifier.getBgColor,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  height: 80,
                                  width: 80,
                                  decoration: BoxDecoration(
                                    color: notifier.getimag,
                                    borderRadius: BorderRadius.circular(15),
                                  ),
                                  child: Center(
                                    child: Config.isValidImageUrl(paymentGatwayApiModel!.data![index].img)
                                        ? Image.network(
                                            Config.resolveImageUrl(paymentGatwayApiModel!.data![index].img),
                                            errorBuilder: (_, __, ___) => Icon(Icons.payment, color: linercolor),
                                          )
                                        : Icon(Icons.payment, color: linercolor),
                                  ),
                                ),
                                SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        "${paymentGatwayApiModel!.data![index].title}",
                                        style: TextStyle(
                                          fontSize: 17,
                                          fontFamily: 'Gilroy_Bold',
                                          color: notifier.text,
                                        ),
                                      ),
                                      SizedBox(
                                        child: Text(
                                          "${paymentGatwayApiModel!.data![index].subtitle}",
                                          style: TextStyle(
                                            fontSize: 14,
                                            fontFamily: 'Gilroy_Medium',
                                            color: greaycolor,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Radio(
                                  activeColor: linercolor,
                                  fillColor: MaterialStateProperty.resolveWith<Color>((states) => notifier.darklinercolor),
                                  value: _groupValue == int.parse(paymentGatwayApiModel!.data![index].id!)
                                      ? true
                                      : false,
                                  groupValue: true,
                                  onChanged: (value) {
                                    setState(() {});
                                  },
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                      separatorBuilder: (BuildContext context, int index) {
                        return paymentGatwayApiModel!.data![index].pShow == "0"
                            ? SizedBox()
                            : SizedBox(height: 10);
                      },
                    ),
                  ),
                ],
              );
            }),
          ),
        );
      },
    );
  }

  stripePayment() {
    return showModalBottomSheet(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      backgroundColor: notifier.getBgColor,
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setState) {
            return SingleChildScrollView(
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              child: Padding(
                padding: EdgeInsets.all(15),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      "Add Your payment information".tr,
                      style: TextStyle(
                        fontFamily: "Gilroy_Bold",
                        fontSize: 20,
                        color: notifier.text,
                      ),
                    ),
                    SizedBox(height: 20),
                    Form(
                      key: _formKey,
                      autovalidateMode: _autoValidateMode,
                      child: Column(
                        children: [
                          textfild(
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              LengthLimitingTextInputFormatter(19),
                              CardNumberInputFormatter(),
                            ],
                            keyboardType: TextInputType.number,
                            controller: numController,
                            onSaved: (String? value) {
                              _paymentCard.number = CardUtils.getCleanedNumber(value!);

                              CardType cardType = CardUtils.getCardTypeFrmNumber(_paymentCard.number.toString());
                              setState(() {
                                _card.name = cardType.toString();
                                _paymentCard.type = cardType;
                              });
                            },
                            onChanged: (val) {
                              CardType cardType = CardUtils.getCardTypeFrmNumber(val);
                              setState(() {
                                _card.name = cardType.toString();
                                _paymentCard.type = cardType;
                              });
                            },
                            hintText: "What number is written on card?".tr,
                            labelText: "Number".tr,
                            validator: CardUtils.validateCardNum,
                            prefixIcon: SizedBox(
                              height: 10,
                              child: Padding(
                                padding: EdgeInsets.symmetric(
                                  vertical: 14,
                                  horizontal: 6,
                                ),
                                child: CardUtils.getCardIcon(_paymentCard.type),
                              ),
                            ),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: textfild(
                                  inputFormatters: [
                                    FilteringTextInputFormatter.digitsOnly,
                                    LengthLimitingTextInputFormatter(3),
                                  ],
                                  hintText: "Number behind the card".tr,
                                  labelText: "CVV".tr,
                                  prefixIcon: SizedBox(
                                    height: 10,
                                    child: Padding(
                                      padding: EdgeInsets.symmetric(vertical: 14),
                                      child: Image.asset(
                                        'assets/card_cvv.png',
                                        width: 6,
                                        color: linercolor,
                                      ),
                                    ),
                                  ),
                                  validator: CardUtils.validateCVV,
                                  keyboardType: TextInputType.number,
                                  onSaved: (value) {
                                    _paymentCard.cvv = int.parse(value!);
                                  },
                                ),
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: textfild(
                                  inputFormatters: [
                                    FilteringTextInputFormatter.digitsOnly,
                                    LengthLimitingTextInputFormatter(4),
                                    CardMonthInputFormatter()
                                  ],
                                  hintText: "MM/YY".tr,
                                  labelText: "Expiry Date".tr,
                                  prefixIcon: SizedBox(
                                    height: 10,
                                    child: Padding(
                                      padding: EdgeInsets.symmetric(vertical: 14),
                                      child: Image.asset(
                                        'assets/calender.png',
                                        width: 10,
                                        color: linercolor,
                                      ),
                                    ),
                                  ),
                                  validator: CardUtils.validateDate,
                                  keyboardType: TextInputType.number,
                                  onSaved: (value) {
                                    List<int> expiryDate = CardUtils.getExpiryDate(value!);
                                    _paymentCard.month = expiryDate[0];
                                    _paymentCard.year = expiryDate[1];
                                  },
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: 20),
                          Container(
                            alignment: Alignment.center,
                            child: SizedBox(
                              width: Get.width,
                              child: CupertinoButton(
                                onPressed: () {
                                  final FormState form = _formKey.currentState!;
                                  if (!form.validate()) {
                                    setState(() {
                                      _autoValidateMode = AutovalidateMode.always; // Start validating on every change.
                                    });
                                    ApiWrapper.showToastMessage("Please fix the errors in red before submitting.".tr);
                                  } else {
                                    var username = getdata.read("UserLogin")["name"];
                                    var email = getdata.read("UserLogin")["email"];
                                    _paymentCard.name = username;
                                    _paymentCard.email = email;
                                    _paymentCard.amount = grandTotal;
                                    form.save();
                                    debugPrint('------- name ------- ${_paymentCard.name}');
                                    debugPrint('------- email ------- ${_paymentCard.email}');
                                    debugPrint('------- amount ------- ${_paymentCard.amount}');
                                    debugPrint('------- month ------- ${_paymentCard.month}');
                                    debugPrint('------- year ------- ${_paymentCard.year}');
                                    webViewPaymentMethod(
                                      initialUrl: "${Config.imageURLPath + Config.stripe}name=${_paymentCard.name}&email=${_paymentCard.email}&cardno=${_paymentCard.number}&cvc=${_paymentCard.cvv}&amt=${_paymentCard.amount}&mm=${_paymentCard.month}&yyyy=${_paymentCard.year}",
                                      status1: "status",
                                      status2: "success",
                                      tId: "Transaction_id",
                                    );
                                    ApiWrapper.showToastMessage("Payment card is valid".tr);
                                  }
                                },
                                color: linercolor,
                                child: Text(
                                  "${"PAY".tr} $currency$grandTotal",
                                  style: TextStyle(
                                    fontSize: 17,
                                    color: whitecolor,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  billPayApi(otid) {
    var uid = getdata.read("Uid") ?? "";
    var orderid = getdata.read("OrderID") ?? "0";
    var body = {
      "uid": uid,
      "order_id": orderid,
      "p_method_id": _groupValue,
      "trans_id": otid,
      "amt": grandTotal
    };
    ApiWrapper.dataPostNode(Config.nodePayBill, body).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        log(val.toString(), name: "Pay Bill Api =====>>>>> : ");

        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          log(val.toString(), name: "Pay Bill Api =====>>>>> : ");
          ApiWrapper.showToastMessage(val["ResponseMsg"]);
          isAdvanceDialogOpened = false;
          pageRefresh();
        }
      }
    });
  }

  PaymentGatwayApiModel? paymentGatwayApiModel;

  paymenrgatway() {
    ApiWrapper.dataGetNode(Config.nodePaymentGateways).then((val) {
      var data = jsonEncode(val);
      debugPrint("============ payment gateway =========== $val");
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          paymentGatwayApiModel = paymentGatwayApiModelFromJson(data);
          setState(() {});
        }
      }
    });
  }

  webViewPaymentMethod({
    required String initialUrl,
    required String status1,
    required String status2,
    required String tId,
  }) {
    debugPrint("************* coman webview *************");
    Get.back();
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => PaymentWebVIew(
          initialUrl: initialUrl,
          navigationDelegate: (request) async {
            final uri = Uri.parse(request.url);

            debugPrint("************ URL *****:--- $initialUrl");
            debugPrint("************ Navigating to URL: ${request.url}");
            debugPrint("************ Parsed URI: $uri");
            debugPrint("************ 2435243254: ${uri.queryParameters[status1]}");
            debugPrint("************ queryParamiter: ${uri.queryParametersAll}");
            debugPrint("************ queryParamiter transaction_id: ${uri.queryParameters[tId]}");
            final status = uri.queryParameters[status1];
            debugPrint(" /*/*/*/*/*/*/*/*/*/*/*/*/*/ Status ---- $status");
            if (status == null) {
              debugPrint("No status parameter found.");
            } else {
              debugPrint("Status parameter: $status");
              if (status == status2) {
                debugPrint("Purchase successful.");
                billPayApi("${uri.queryParameters[tId]}");
                return NavigationDecision.prevent;
              } else {
                debugPrint("Purchase failed with status: $status.");
                Navigator.pop(context);
                tostmsg(status);
                return NavigationDecision.prevent;
              }
            }
            return NavigationDecision.navigate;
          },
        ),
      ),
    );
  }

  mapinfo() async {
    setState(() {});
    isLoading = true;
    var orderid = getdata.read("OrderID") ?? "0";
    var data = {"orderid": orderid};
    ApiWrapper.dataPostNode(Config.nodeMapInfo, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          buyMapinfo = val["Mapinfo"];
          isLoading = false;
          setState(() {});
        } else {
          setState(() {
            isLoading = false;
          });
        }
      }
    });
  }

  showQrDialog(String imageUrl) {
    return showDialog(
      context: context,
      builder: (context) {
        return Dialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          backgroundColor: notifier.getBgColor,
          child: Padding(
            padding: const EdgeInsets.all(15),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      "Rider UPI QR Code".tr,
                      style: TextStyle(
                        color: notifier.text,
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 18,
                      ),
                    ),
                    IconButton(
                      icon: Icon(Icons.close, color: notifier.text),
                      onPressed: () => Get.back(),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(15),
                  child: Image.network(
                    imageUrl,
                    height: Get.height * 0.35,
                    width: Get.width * 0.7,
                    fit: BoxFit.contain,
                    errorBuilder: (context, error, stackTrace) {
                      return SizedBox(
                        height: 150,
                        child: Center(
                          child: Text(
                            "Unable to load QR image".tr,
                            style: TextStyle(color: notifier.text),
                          ),
                        ),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 15),
                InkWell(
                  onTap: () => Get.back(),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 25),
                    decoration: BoxDecoration(
                      color: linercolor,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      "Close".tr,
                      style: TextStyle(
                        color: whitecolor,
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 16,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> downloadInvoice() async {
    String orderIdToUse = orderProduc?["order_id"]?.toString() ?? buyMapinfo?["order_id"]?.toString() ?? orderid;
    if (orderIdToUse.isEmpty || orderIdToUse == "0") {
      orderIdToUse = (getdata.read("OrderID") ?? "0").toString();
    }

    Map<String, dynamic> body = {
      "order_id": orderIdToUse,
      "uid": uid,
    };

    setState(() {
      isInvoiceLoading = true;
    });

    try {
      var value = await ApiWrapper.dataPostNode(Config.nodeInvoiceUrl, body);
      setState(() {
        isInvoiceLoading = false;
      });

      if (value != null && (value["Result"] == "true" || value["Result"] == true) && value["invoice_url"] != null) {
        String invoiceUrl = value["invoice_url"].toString();
        Uri uri = Uri.parse(invoiceUrl);
        if (await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        } else {
          await launchUrl(uri);
        }
      } else {
        String msg = value?["ResponseMsg"] ?? "Failed to generate invoice URL".tr;
        ApiWrapper.showToastMessage(msg);
      }
    } catch (e) {
      setState(() {
        isInvoiceLoading = false;
      });
      ApiWrapper.showToastMessage("Error generating invoice: $e");
    }
  }

  bool get _isAdvancePaymentRequiredForOrder {
    if (_advancePaymentCompleted) return false;
    if (widget.type != "Pickup") return false;
    var dataObj = orderProduc ?? buyMapinfo;
    if (dataObj == null) return false;

    final flowId = int.tryParse(
      (dataObj["Order_flow_id"] ?? dataObj["order_status"] ?? "0").toString(),
    );
    final advanceAmount = double.tryParse(
      (dataObj["advance_payment"] ?? dataObj["advance_payment "] ?? "0").toString(),
    ) ?? 0;
    if (flowId != 1 || advanceAmount <= 0) return false;

    dynamic pStatus = dataObj["payment_status"];
    if (pStatus != null && pStatus.toString() == "1") return false;

    return true;
  }

  void checkAdvancePaymentStatus() {
    if (orderProduc == null && buyMapinfo == null) return;

    // Keep a confirmed payment from reopening the modal if the subsequent
    // order refresh briefly returns the old payment_status value.
    if (_advancePaymentCompleted) {
      _closeStuckAdvanceDialogIfOpen();
      return;
    }

    var dataObj = orderProduc ?? buyMapinfo;

    // Advance payment exists only for an accepted package order. This avoids
    // displaying a zero-amount payment dialog for pending, cancelled, or
    // buy-anything orders when their ordinary payment_status is still 0.
    if (widget.type != "Pickup") {
      _closeStuckAdvanceDialogIfOpen();
      return;
    }
    final flowId = int.tryParse(
      (dataObj?["Order_flow_id"] ?? dataObj?["order_status"] ?? "0").toString(),
    );
    final advanceAmount = double.tryParse(
      (dataObj?["advance_payment"] ?? dataObj?["advance_payment "] ?? "0").toString(),
    ) ?? 0;
    if (flowId != 1 || advanceAmount <= 0) {
      // The order stopped qualifying for this dialog since it was last
      // shown — most notably, the driver cancelled after accepting (before
      // paying the advance) and the order went back to dispatch, dropping
      // flowId away from 1. That used to just fall through this guard
      // without telling the dialog anything: it's barrierDismissible:false
      // with a WillPopScope blocking the back button too, so nothing the
      // customer could do closed it — they were stuck on "Advance Payment
      // Required" for an order that had already moved on (confirmed live).
      _closeStuckAdvanceDialogIfOpen();
      return;
    }

    dynamic pStatus = dataObj?["payment_status"];
    if (pStatus != null && pStatus.toString() == "1") {
      _closeStuckAdvanceDialogIfOpen();
      return;
    }
    if (!isAdvanceDialogOpened) {
      isAdvanceDialogOpened = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        showAdvancePaymentDialog();
      });
    }
  }

  /// Cancels the advance-payment countdown and, if its dialog is currently
  /// showing, pops it — the only way it closes for any reason other than
  /// the customer tapping its own Pay/Cancel buttons or its timer expiring.
  void _closeStuckAdvanceDialogIfOpen() {
    _advanceTimer?.cancel();
    _advanceTimer = null;
    if (!isAdvanceDialogOpened) return;
    isAdvanceDialogOpened = false;
    if (mounted && Navigator.of(context, rootNavigator: true).canPop()) {
      Navigator.of(context, rootNavigator: true).pop();
    }
  }

  /// Looks up the customer's referral-points balance and the admin-configured
  /// ride_discount_percent/point_value ahead of showing the advance-payment
  /// dialog, so the "Pay with referral points" button only appears when the
  /// feature is enabled and the customer actually has points to spend.
  Future<Map<String, dynamic>?> _fetchReferralDiscountInfo() async {
    final currentUid = (uid.toString().isNotEmpty && uid.toString() != "0")
        ? uid.toString()
        : (getdata.read("Uid") ?? "").toString();
    if (currentUid.isEmpty || currentUid == "0") return null;
    try {
      final response = await ApiWrapper.dataGetNode('${Config.nodeReferralDiscountInfo}?uid=$currentUid');
      if (response is Map && (response['Result'] == true || response['Result'] == 'true')) {
        return Map<String, dynamic>.from(response);
      }
    } catch (e) {
      debugPrint("======== Referral Discount Info Error ======== $e");
    }
    return null;
  }

  showAdvancePaymentDialog() async {
    final referralInfo = await _fetchReferralDiscountInfo();
    final bool referralEnabled = referralInfo != null && referralInfo['enabled'] == true;
    final double referralPointsAvailable =
        double.tryParse((referralInfo?['referral_points_available'] ?? 0).toString()) ?? 0;
    if (!mounted) return;
    // The booking response may omit currency for some orders. Interpolating
    // the nullable global directly would render the literal string "null"
    // before every amount (for example, "null15"). Keep the payment dialog
    // usable even when that optional response field is missing.
    final String paymentCurrency = (currency == null ||
            currency!.trim().isEmpty ||
            currency!.trim().toLowerCase() == 'null')
        ? '₹'
        : currency!.trim();

    String advanceAmount = (orderProduc?["advance_payment "] ??
            orderProduc?["advance_payment"] ??
            buyMapinfo?["advance_payment "] ??
            buyMapinfo?["advance_payment"] ??
            "0")
        .toString();

    String rawActualTotal = (orderProduc?["grand_total"] ??
            orderProduc?["total_Delivery_charge"] ??
            buyMapinfo?["grand_total"] ??
            buyMapinfo?["total_Delivery_charge"] ??
            grandTotal ??
            "0")
        .toString();

    double advDouble = double.tryParse(advanceAmount) ?? 0.0;
    double actualDouble = double.tryParse(rawActualTotal) ?? 0.0;
    if (actualDouble == 0.0 && advDouble > 0) {
      actualDouble = advDouble;
    }
    double remainingDouble = (actualDouble - advDouble) > 0 ? (actualDouble - advDouble) : 0.0;

    // Mutable: reduced in place when referral points partially cover the
    // advance, so the Razorpay button below always asks for what's still due.
    double dueAdvanceAmount = advDouble;
    bool referralPointsRedeemed = false;

    String actualAmountStr = (actualDouble % 1 == 0)
        ? actualDouble.toInt().toString()
        : actualDouble.toStringAsFixed(2);

    String remainingAmountStr = (remainingDouble % 1 == 0)
        ? remainingDouble.toInt().toString()
        : remainingDouble.toStringAsFixed(2);

    String advanceMsg = (orderProduc?["advance_payment_msg"] ?? buyMapinfo?["advance_payment_msg"] ?? "Please complete the advance payment to confirm your order. Kindly note that if the payment is not completed within 2 minutes, your order will be automatically cancelled.").toString();

    String rawTimerStr = (orderProduc?["advance_payment_timer"] ?? buyMapinfo?["advance_payment_timer"] ?? "").toString().trim();
    int timerSeconds = int.tryParse(rawTimerStr) ?? 0;
    if (timerSeconds <= 0) {
      timerSeconds = 120; // Default 120 seconds if missing, null, empty, or 0
    }

    _advanceTimer?.cancel();
    _advanceTimer = null;
    _remainingSeconds = timerSeconds;

    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            // Start countdown timer if timerSeconds > 0 and not started yet
            if (_advanceTimer == null && timerSeconds > 0) {
              _remainingSeconds = timerSeconds;
              _advanceTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
                if (_remainingSeconds > 1) {
                  if (mounted) {
                    setDialogState(() {
                      _remainingSeconds--;
                    });
                  } else {
                    _remainingSeconds--;
                  }
                } else {
                  // Timer expired!
                  timer.cancel();
                  _advanceTimer = null;
                  isAdvanceDialogOpened = false;

                  if (Navigator.of(dialogContext, rootNavigator: true).canPop()) {
                    Navigator.of(dialogContext, rootNavigator: true).pop();
                  }

                  // Auto-cancel order on advance payment timeout
                  pksCancleOrder(comment: "Advance payment timeout (2 minutes exceeded)");
                }
              });
            }

            return WillPopScope(
              onWillPop: () async {
                // Strictly prevent back button from closing dialog
                return false;
              },
              child: AlertDialog(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
                backgroundColor: notifier.getBgColor,
                title: Column(
                  children: [
                    Icon(Icons.payment, size: 45, color: linercolor),
                    SizedBox(height: 10),
                    Text(
                      "Advance Payment Required".tr,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: notifier.text,
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 18,
                      ),
                    ),
                  ],
                ),
                content: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      "Advance payment is required to proceed with this order. Please complete the advance payment.".tr,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: greaycolor,
                        fontFamily: 'Gilroy_Medium',
                        fontSize: 14,
                      ),
                    ),

                    // Highlighted advance_payment_msg banner
                    if (advanceMsg.isNotEmpty) ...[
                      SizedBox(height: 12),
                      Container(
                        width: double.infinity,
                        padding: EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Color(0xFFFFF3CD),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Color(0xFFFFEEBA), width: 1.5),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.info_outline, color: Color(0xFF856404), size: 22),
                            SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                advanceMsg,
                                style: TextStyle(
                                  color: Color(0xFF856404),
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    SizedBox(height: 15),
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                      decoration: BoxDecoration(
                        color: linercolor.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: linercolor.withOpacity(0.25)),
                      ),
                      child: Column(
                        children: [
                          // 1. Advance Amount
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                referralPointsRedeemed ? "Advance Due".tr : "Advance Amount".tr,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 15,
                                ),
                              ),
                              Text(
                                "$paymentCurrency${(dueAdvanceAmount % 1 == 0) ? dueAdvanceAmount.toInt().toString() : dueAdvanceAmount.toStringAsFixed(2)}",
                                style: TextStyle(
                                  color: linercolor,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 18,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Divider(color: greaycolor.withOpacity(0.2), height: 1),
                          const SizedBox(height: 10),

                          // 2. Actual Amount
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                "Actual Amount".tr,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Medium',
                                  fontSize: 14,
                                ),
                              ),
                              Text(
                                "$paymentCurrency$actualAmountStr",
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 15,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Divider(color: greaycolor.withOpacity(0.2), height: 1),
                          const SizedBox(height: 10),

                          // 3. Remaining Amount (Remaining Amount after advance payment)
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      "Remaining Amount".tr,
                                      style: TextStyle(
                                        color: notifier.text,
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 14,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      "Remaining Amount after advance payment".tr,
                                      style: TextStyle(
                                        color: greaycolor.withOpacity(0.85),
                                        fontFamily: 'Gilroy_Medium',
                                        fontSize: 11,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                "$paymentCurrency$remainingAmountStr",
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 15,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    // Countdown Timer Display
                    if (_remainingSeconds > 0) ...[
                      SizedBox(height: 12),
                      Container(
                        padding: EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                        decoration: BoxDecoration(
                          color: Colors.red.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Colors.red.withOpacity(0.4)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.timer_outlined, color: Colors.red, size: 20),
                            SizedBox(width: 6),
                            Text(
                              "${"Time Remaining:".tr} ${_formatTimerText(_remainingSeconds)}",
                              style: TextStyle(
                                color: Colors.red,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
                actionsPadding: EdgeInsets.only(left: 15, right: 15, bottom: 15),
                actions: [
                  if (referralEnabled && referralPointsAvailable > 0 && !referralPointsRedeemed && dueAdvanceAmount > 0) ...[
                    SizedBox(
                      width: double.infinity,
                      child: InkWell(
                        onTap: _redeemingReferralPoints
                            ? null
                            : () async {
                                setDialogState(() => _redeemingReferralPoints = true);
                                String currentOrderId = buyMapinfo?["order_id"]?.toString() ??
                                    orderProduc?["order_id"]?.toString() ??
                                    orderid;
                                if (currentOrderId.isEmpty || currentOrderId == "0") {
                                  currentOrderId = (getdata.read("OrderID") ?? "0").toString();
                                }
                                try {
                                  final response = await ApiWrapper.dataPostNode(
                                    Config.nodeAdvancePaymentRedeemPoints,
                                    {"order_id": currentOrderId},
                                  );
                                  if (response is Map &&
                                      response['ResponseCode']?.toString() == "200" &&
                                      (response['Result'] == true || response['Result'] == "true")) {
                                    final pointsUsed = double.tryParse((response['points_used'] ?? 0).toString()) ?? 0;
                                    final remaining = double.tryParse((response['remaining_amount'] ?? 0).toString()) ?? 0;
                                    final paymentStatus = response['payment_status']?.toString();
                                    ApiWrapper.showToastMessage(response['ResponseMsg'] ?? "Referral points applied".tr);
                                    if (remaining <= 0 || paymentStatus == "1") {
                                      // Fully covered by points - mirror the same
                                      // post-success flow as a successful Razorpay
                                      // advance payment (see callAdvancePaymentApi).
                                      _closeStuckAdvanceDialogIfOpen();
                                      isAdvancePaymentFlow = false;
                                      _advancePaymentCompleted = true;
                                      await pageRefresh();
                                    } else {
                                      // callAdvancePaymentApi (called after the
                                      // Razorpay checkout below succeeds) reads the
                                      // due amount straight back out of
                                      // orderProduc["advance_payment"], not from
                                      // dueAdvanceAmount — without updating it here
                                      // too, that later call would verify the
                                      // payment against the stale pre-redemption
                                      // amount instead of what Razorpay actually
                                      // charged, and fail.
                                      if (orderProduc != null) {
                                        orderProduc!["advance_payment"] = remaining.toString();
                                        orderProduc!["advance_payment "] = remaining.toString();
                                      }
                                      setDialogState(() {
                                        dueAdvanceAmount = remaining;
                                        if (pointsUsed > 0) referralPointsRedeemed = true;
                                        _redeemingReferralPoints = false;
                                      });
                                    }
                                  } else {
                                    ApiWrapper.showToastMessage(
                                      (response is Map ? response['ResponseMsg'] : null) ??
                                          "Could not apply referral points".tr,
                                    );
                                    setDialogState(() => _redeemingReferralPoints = false);
                                  }
                                } catch (e) {
                                  debugPrint("======== Redeem Referral Points Error ======== $e");
                                  ApiWrapper.showToastMessage("Error: $e");
                                  setDialogState(() => _redeemingReferralPoints = false);
                                }
                              },
                        child: Container(
                          margin: EdgeInsets.only(bottom: 10),
                          padding: EdgeInsets.symmetric(vertical: 12),
                          decoration: BoxDecoration(
                            color: linercolor.withOpacity(0.10),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: linercolor),
                          ),
                          child: Center(
                            child: _redeemingReferralPoints
                                ? SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: linercolor),
                                  )
                                : Text(
                                    "Pay with referral points".tr,
                                    style: TextStyle(
                                      color: linercolor,
                                      fontFamily: "Gilroy_Bold",
                                      fontSize: 14,
                                    ),
                                  ),
                          ),
                        ),
                      ),
                    ),
                  ],
                  Row(
                    children: [
                      Expanded(
                        child: InkWell(
                          onTap: () {
                            _advanceTimer?.cancel();
                            _advanceTimer = null;
                            isAdvanceDialogOpened = false;
                            Navigator.of(context, rootNavigator: true).pop();
                            String itemIDToCancel = buyMapinfo?["order_id"]?.toString() ??
                                orderProduc?["order_id"]?.toString() ??
                                orderid;
                            dialogShow(itemIDToCancel);
                          },
                          child: Container(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            decoration: BoxDecoration(
                              color: Color(0xffFF5656),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Center(
                              child: Text(
                                "Order Cancel".tr,
                                style: TextStyle(
                                  color: whitecolor,
                                  fontFamily: "Gilroy_Bold",
                                  fontSize: 15,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 10),
                      Expanded(
                        child: InkWell(
                          onTap: () {
                            final payableAmount = (dueAdvanceAmount % 1 == 0)
                                ? dueAdvanceAmount.toInt().toString()
                                : dueAdvanceAmount.toStringAsFixed(2);
                            _advanceTimer?.cancel();
                            _advanceTimer = null;
                            isAdvanceDialogOpened = false;
                            Navigator.of(context, rootNavigator: true).pop();
                            setState(() {
                              grandTotal = payableAmount;
                            });
                            _payAdvanceWithRazorpay(payableAmount);
                          },
                          child: Container(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            decoration: BoxDecoration(
                              color: linercolor,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Center(
                              child: Text(
                                "Continue".tr,
                                style: TextStyle(
                                  color: whitecolor,
                                  fontFamily: "Gilroy_Bold",
                                  fontSize: 15,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  _payAdvanceWithRazorpay(String advanceAmount) {
    isAdvancePaymentFlow = true;
    double amount = double.tryParse(advanceAmount) ?? 0.0;
    if (amount <= 0) {
      ApiWrapper.showToastMessage("Invalid advance payment amount".tr);
      return;
    }

    var mobile = getdata.read("UserLogin")["mobile"];
    var data = {
      "mobile": mobile,
      "amount": amount.toString(),
    };

    debugPrint("======== Creating Order Data for Advance Payment ======== $data");

    ApiWrapper.dataPostNode(Config.nodeCreateOrder, data).then((val) {
      if ((val != null) && (val.isNotEmpty)) {
        debugPrint("======== Order Response ======== $val");

        if ((val['ResponseCode'] == "200") && (val['Result'] == "true")) {
          razorpayOrderId = val["OrderId"];
          debugPrint("======== Razorpay Order ID ======== $razorpayOrderId");

          if (razorpayOrderId == null || razorpayOrderId!.isEmpty) {
            ApiWrapper.showToastMessage("Order ID not received from server".tr);
            return;
          }

          String razorpayKey = "rzp_test_Rr8n8p41taq6fM";
          int amountInPaise = (amount * 100).toInt();

          debugPrint("======== Amount in Paise ======== $amountInPaise");
          debugPrint("======== User Mobile ======== ${getdata.read("UserLogin")["mobile"]}");
          debugPrint("======== User Name ======== ${getdata.read("UserLogin")["name"]}");

          try {
            razorPayClass.openCheckout(
              key: razorpayKey,
              amount: amountInPaise.toString(),
              orderId: razorpayOrderId!,
              number: getdata.read("UserLogin")["mobile"]?.toString() ?? "",
              name: getdata.read("UserLogin")["name"]?.toString() ?? "User",
              description: "Advance Payment",
              currency: "INR",
            );
            debugPrint("======== Razorpay Checkout Opened ========");
          } catch (e) {
            debugPrint("======== Razorpay Error ======== $e");
            ApiWrapper.showToastMessage("Failed to open payment gateway: $e");
          }
        } else {
          ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Failed to create order".tr);
        }
      } else {
        ApiWrapper.showToastMessage("Something went wrong".tr);
      }
    }).catchError((error) {
      debugPrint("======== Create Order Error ======== $error");
      ApiWrapper.showToastMessage("Network error: $error");
    });
  }

  callAdvancePaymentApi({
    required String paymentId,
    required String signature,
  }) {
    String currentOrderId = orderProduc?["order_id"]?.toString() ??
        buyMapinfo?["order_id"]?.toString() ??
        orderid;
    if (currentOrderId.isEmpty || currentOrderId == "0") {
      currentOrderId = (getdata.read("OrderID") ?? "0").toString();
    }

    String riderId = (orderProduc?["rider_id"] ?? "0").toString();
    String advanceAmt = (orderProduc?["advance_payment "] ??
            orderProduc?["advance_payment"] ??
            grandTotal ??
            "0")
        .toString();

    var body = {
      "order_id": currentOrderId,
      "amount": advanceAmt,
      "razorpay_payment_id": paymentId,
      "razorpay_order_id": razorpayOrderId ?? "",
      "razorpay_signature": signature,
      "rid": riderId,
    };

    debugPrint("======== Calling Advance Payment API ========");
    debugPrint("Body: $body");

    ApiWrapper.dataPostNode(Config.nodeAdvancePayment, body).then((val) async {
      if ((val != null) && (val.isNotEmpty)) {
        debugPrint("======== Advance Payment Response ======== $val");
        if ((val['ResponseCode'] == "200") &&
            (val['Result'] == true || val['Result'] == "true")) {
          ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Advance Payment Success".tr);

          // The advance-payment dialog is non-dismissible, so changing the
          // flag alone leaves its route visible after Razorpay succeeds.
          // Cancel its countdown and pop the dialog before refreshing the
          // order snapshot.
          _closeStuckAdvanceDialogIfOpen();
          isAdvancePaymentFlow = false;
          _advancePaymentCompleted = true;
          await pageRefresh();
        } else {
          ApiWrapper.showToastMessage(val["ResponseMsg"] ?? "Advance Payment Failed".tr);
        }
      }
    }).catchError((error) {
      debugPrint("======== Advance Payment API Error ======== $error");
      ApiWrapper.showToastMessage("Error: $error");
    });
  }

}
