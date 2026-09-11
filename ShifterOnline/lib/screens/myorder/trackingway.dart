// ignore_for_file: deprecated_member_use, prefer_typing_uninitialized_variables

import 'dart:async';
import 'dart:convert';
import 'dart:developer';
import 'dart:math' as math;
import 'dart:ui';
import 'package:dotted_line/dotted_line.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
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
import 'package:goParcel/screens/home/wallet_page.dart';
import 'package:goParcel/screens/home/trackingpoliyline.dart';
import 'package:goParcel/screens/home/trackingview.dart';
import 'package:goParcel/screens/home/trakingStore.dart';
import 'package:goParcel/screens/myorder/live_driver_tracking.dart';
import 'package:goParcel/screens/profile/faq.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:goParcel/utils/customewidget/customwidgets.dart';
import 'package:goParcel/utils/node_socket_manager.dart';
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

  // Latest driver position from the Node socket.
  double? liveDriverLat;
  double? liveDriverLng;

  // Live tracking map: the marker's CURRENT rendered position (mid-animation
  // between the last two pings, not necessarily the latest raw ping) plus
  // the heading it's animating along, and the vehicle-category icon loaded
  // once per category so it isn't re-fetched on every rebuild.
  GoogleMapController? _liveMapController;
  LatLng? _driverMapPosition;
  double _driverMapBearing = 0;
  BitmapDescriptor? _driverIcon;
  String? _driverIconCategory;
  AnimationController? _driverAnimController;
  bool _mapFitted = false;

  @override
  void dispose() {
    _advanceTimer?.cancel();
    _driverAnimController?.dispose();
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
      setState(() => _driverMapBearing = _bearingBetween(start, target));
    } else {
      setState(() => _driverMapPosition = target);
    }

    _driverAnimController?.dispose();
    final controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 9000));
    _driverAnimController = controller;
    final latAnim = Tween<double>(begin: (start ?? target).latitude, end: target.latitude).animate(controller);
    final lngAnim = Tween<double>(begin: (start ?? target).longitude, end: target.longitude).animate(controller);
    controller.addListener(() {
      if (!mounted) return;
      setState(() => _driverMapPosition = LatLng(latAnim.value, lngAnim.value));
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

  Widget _liveTrackingMapCard() {
    final pLat = double.tryParse(orderProduc?['plat']?.toString() ?? '');
    final pLng = double.tryParse(orderProduc?['plong']?.toString() ?? '');
    if (pLat == null || pLng == null) return const SizedBox();

    final category = orderProduc?['category']?.toString() ?? '';
    if (category.isNotEmpty && _driverIconCategory != category) _loadDriverIcon(category);

    return Container(
      height: 190,
      margin: const EdgeInsets.only(bottom: 14),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: notifier.bordecolor)),
      child: GoogleMap(
        initialCameraPosition: CameraPosition(target: _driverMapPosition ?? LatLng(pLat, pLng), zoom: 12),
        markers: _buildMapMarkers(),
        myLocationButtonEnabled: false,
        zoomControlsEnabled: false,
        // Keep map gestures inside the map instead of scrolling the parent
        // order-details view when the user pans or zooms.
        gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{
          Factory<EagerGestureRecognizer>(() => EagerGestureRecognizer()),
        },
        onMapCreated: (controller) {
          _liveMapController = controller;
          _fitMapToMarkers();
        },
      ),
    );
  }

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

  @override
  Widget build(BuildContext context) {
    Future.delayed(Duration(seconds: 2), () {
      if (mounted) {
        setState(() {});
      }
    });

    notifier = Provider.of(context, listen: true);
    return WillPopScope(
      onWillPop: () async {
        if (orderProduc != null &&
            (orderProduc["payment_status"] ?? "").toString() != "1") {
          return false;
        }
        if (orderProduc != null && orderProduc["Order_Status"] == "Completed") {
          if (widget.isback == true) {
            Get.back();
            debugPrint("--------------------------------");
          } else {
            debugPrint("======== off all ================");
            Get.offAll(Bottombar());
          }
        } else {
          Get.back();
          debugPrint("=================================");
        }
        return true;
      },
      child: Scaffold(
        backgroundColor: linercolor,
        appBar: AppBar(
          centerTitle: true,
          elevation: 0,
          backgroundColor: linercolor,
          bottom: const PreferredSize(
            preferredSize: Size.fromHeight(32),
            child: SocketStatusBanner(),
          ),
          title: Text(
            "Order Details".tr,
            style: TextStyle(
              color: whitecolor,
              fontFamily: "Gilroy_Bold",
            ),
          ),
          actions: [
            Row(
              children: [
                InkWell(
                  onTap: () => Get.to(() => Tracklast(type: "OrderDone")),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(15),
                      border: Border.all(color: Colors.white.withOpacity(0.4)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.map_rounded, color: Colors.white, size: 16),
                        const SizedBox(width: 4),
                        Text(
                          "View Map".tr,
                          style: const TextStyle(
                            color: Colors.white,
                            fontFamily: "Gilroy_Bold",
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                buyMapinfo != null && orderProduc != null
                    ? (orderProduc["Order_Status"] != "Completed" && orderProduc["Order_Status"] != "Cancelled"
                    ? InkWell(
                  onTap: pageRefresh,
                  child: !isLoading
                      ? Image.asset(
                    "assets/refresh.png",
                    height: 20,
                    color: whitecolor,
                  )
                      : loading(),
                )
                    : SizedBox())
                    : SizedBox(),
                SizedBox(width: 15),
                InkWell(
                  onTap: () => Get.to(() => Faq()),
                  child: Image.asset(
                    "assets/faq.png",
                    height: 25,
                    color: whitecolor,
                  ),
                ),
                SizedBox(width: 10),
              ],
            ),
          ],
        ),
        floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
        floatingActionButton: Container(
          decoration: BoxDecoration(),
          padding: EdgeInsets.all(10),
          width: Get.width,
          child: (orderProduc != null && buyMapinfo != null
              ? (orderProduc["Order_Status"] == "Completed"
              ? Row(
            children: [
              if (orderProduc["is_rate"] == "0") ...[
                Expanded(
                  child: appButton1(
                    tital: "Order Review".tr,
                    buttonbgColor: linercolor,
                    bordecolor: linercolor,
                    onTap: () {
                      commit.clear();
                      reviewRider();
                    },
                  ),
                ),
                SizedBox(width: 10),
              ],
              Expanded(
                child: appButton1(
                  tital: isInvoiceLoading
                      ? "Please wait...".tr
                      : "Order Invoice".tr,
                  buttonbgColor: greencolor,
                  bordecolor: greencolor,
                  onTap: () {
                    if (!isInvoiceLoading) {
                      downloadInvoice();
                    }
                  },
                ),
              ),
            ],
          )
              : orderProduc["Order_Status"] == "Cancelled"
              ? SizedBox()
              : (widget.type != "Pickup" && buyMapinfo["order_step"] == 6)
              ? Row(
            children: [
              Expanded(
                child: appButton1(
                  tital: "Order Cancel",
                  bordecolor: Color(0xffFF5656),
                  buttonbgColor: Color(0xffFF5656),
                  onTap: () {
                    dialogShow(buyMapinfo["order_id"] ?? orderid);
                  },
                ),
              ),
              SizedBox(width: 10),
              Expanded(
                child: appButton1(
                  bordecolor: greencolor,
                  buttonbgColor: greencolor,
                  tital: "${"PAY".tr} $currency$grandTotal",
                  onTap: () {
                    setState(() {
                      grandTotal = grandTotal;
                    });
                    _payAdvanceWithRazorpay(grandTotal.toString());
                  },
                ),
              ),
            ],
          )
              : Container(
            width: Get.width,
            decoration: BoxDecoration(),
            child: appButton1(
              tital: "Order Cancel",
              bordecolor: Color(0xffFF5656),
              buttonbgColor: Color(0xffFF5656),
              onTap: () {
                dialogShow(buyMapinfo["order_id"] ?? orderid);
              },
            ),
          ))
              : SizedBox()),
        ),
        body: RefreshIndicator(
          backgroundColor: notifier.lightBgColor,
          color: linercolor,
          onRefresh: pageRefresh,
          child: Container(
            height: Get.height,
            width: Get.width,
            padding: EdgeInsets.only(top: 2),
            decoration: BoxDecoration(
              color: notifier.lightBgColor,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(24),
                topRight: Radius.circular(24),
              ),
            ),
            child: isLoading == true
                ? Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Center(
                  child: CircularProgressIndicator(color: linercolor),
                ),
              ],
            )
                : ImageFiltered(
              imageFilter: (orderProduc != null &&
                  (orderProduc["payment_status"] ?? "").toString() != "1")
                  ? ImageFilter.blur(sigmaX: 12, sigmaY: 12)
                  : ImageFilter.blur(sigmaX: 0, sigmaY: 0),
              child: IgnorePointer(
                ignoring: (orderProduc != null &&
                    (orderProduc["payment_status"] ?? "").toString() != "1"),
                child: SingleChildScrollView(
                  padding: EdgeInsets.all(15),
                  physics: BouncingScrollPhysics(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        "${"Order".tr} #${getdata.read("OrderID") ?? "0"}",
                        style: TextStyle(
                          color: notifier.text,
                          fontSize: 16,
                          fontFamily: 'Gilroy_Bold',
                        ),
                      ),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(40),
                          color: statusColor.withOpacity(0.10),
                        ),
                        child: Text(
                          orderProduc != null
                              ? "${orderProduc["Order_Status"]}"
                              : "",
                          style: TextStyle(
                            color: statusColor,
                            fontFamily: 'Gilroy_Medium',
                          ),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 10),

                  // ── Live tracking map — real driver marker (vehicle-category
                  // icon, smoothly animated between location pings) in place
                  // of the button that used to just link out to the separate,
                  // legacy-PHP-backed Tracklast screen.
                  if (orderProduc != null && orderProduc["rider_id"] != null)
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.map_outlined),
                        label: const Text("Live Track Driver"),
                        onPressed: () {
                          Get.to(() => LiveDriverTracking(
                                orderId: orderid,
                                type: widget.type,
                                initialOrderData: Map<String, dynamic>.from(orderProduc),
                              ));
                        },
                      ),
                    ),

                  SizedBox(height: 10),
                  Container(
                    width: Get.width,
                    padding: EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: notifier.getBgColor,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: orderProduc == null
                        ? SizedBox()
                        : Wrap(
                      runSpacing: 10,
                      spacing: 5,
                      children: [
                        oderDetailsText(
                          title: "ID".tr,
                          subtitle: "#${getdata.read("OrderID") ?? "0"}",
                        ),
                        orderProduc["distance"] != null
                            ? oderDetailsText(
                          title: "Distance".tr,
                          subtitle: "${orderProduc["distance"]} km.",
                        )
                            : SizedBox(),
                        orderProduc["order_date"] != null && orderProduc["order_date"].toString().isNotEmpty
                            ? oderDetailsText(
                          title: "Order Date".tr,
                          subtitle: DateFormat("EEE, d MMM, yyyy").format(DateTime.parse(orderProduc["order_date"])),
                        )
                            : SizedBox(),
                        orderProduc["order_deliver_date"] != null && orderProduc["order_deliver_date"].toString().isNotEmpty
                            ? oderDetailsText(
                          title: "Order Delivered Date",
                          subtitle: DateFormat("EEE, d MMM, yyyy").format(DateTime.parse(orderProduc["order_deliver_date"])),
                        )
                            : SizedBox(),
                        orderProduc["package_weight"] != null
                            ? oderDetailsText(
                          title: "Weight".tr,
                          subtitle: "${orderProduc["package_weight"]} Kg.",
                        )
                            : SizedBox(),
                        orderProduc["category"] != null
                            ? oderDetailsText(
                          title: "Category".tr,
                          subtitle: "${orderProduc["category"]}",
                        )
                            : SizedBox(),

                        // ── Booking Type
                        if (orderProduc["booking_type"] != null &&
                            orderProduc["booking_type"].toString().isNotEmpty)
                          oderDetailsText(
                            title: "Booking Type".tr,
                            subtitle: orderProduc["booking_type"].toString() == "1"
                                ? "Current Booking".tr
                                : orderProduc["booking_type"].toString() == "2"
                                ? "Schedule Booking".tr
                                : "Next Day Booking".tr,
                          ),

                        // ── Schedule Date & Time (only for booking_type == 2)
                        if (orderProduc["booking_type"] != null &&
                            orderProduc["booking_type"].toString() == "2" &&
                            orderProduc["schedule_date_time"] != null &&
                            orderProduc["schedule_date_time"].toString().isNotEmpty)
                          oderDetailsText(
                            title: "Schedule Time".tr,
                            subtitle: "${orderProduc["schedule_date_time"]}",
                          ),

                        // ── Your OTP
                       /* if (orderProduc["otp"] != null &&
                            orderProduc["otp"].toString().isNotEmpty)
                          oderDetailsText(
                            title: "Your OTP".tr,
                            subtitle: "${orderProduc["otp"]}",
                          ),*/

                        if (orderProduc["otp"] != null &&
                            orderProduc["otp"].toString().isNotEmpty) ...[
                          SizedBox(height: 10),
                          otpHighlightCard("${orderProduc["otp"]}"),
                        ],

                        // Driver has actually arrived and is waiting on the
                        // OTP — matches tripLifecycle.sweepOverduePickups'
                        // real 10-minute no-show auto-cancel + cancellation
                        // charge on the backend, not just a scary-sounding
                        // label with nothing behind it.
                        if (orderProduc["Order_Status"] == "Pickup") ...[
                          SizedBox(height: 8),
                          Container(
                            width: Get.width,
                            padding: EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: Colors.orange.withOpacity(0.08),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.orange.withOpacity(0.4)),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(Icons.info_outline_rounded, color: Colors.orange.shade800, size: 18),
                                SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    "Your driver has arrived at the pickup location. Please share the OTP within 10 minutes — if it isn't provided in time, the trip will be automatically cancelled and a cancellation charge will apply.".tr,
                                    style: TextStyle(color: Colors.orange.shade800, fontSize: 11, fontFamily: 'Gilroy_Medium', height: 1.35),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],

                        // ── Advance Payment
                        if (orderProduc["advance_payment"] != null ||
                            orderProduc["advance_payment"] != null)
                          oderDetailsText(
                            title: "Advance Payment".tr,
                            subtitle: "$currency${orderProduc["advance_payment"] ?? orderProduc["advance_payment"]}",
                          ),

                        // ── Vehicle No
                        if (orderProduc["vehicle_no"] != null &&
                            orderProduc["vehicle_no"].toString().isNotEmpty)
                          oderDetailsText(
                            title: "Vehicle No".tr,
                            subtitle: "${orderProduc["vehicle_no"]}",
                          ),

                        // ── Show QR Button
                       /* if (orderProduc["upi_image"] != null &&
                            orderProduc["upi_image"].toString().isNotEmpty)
                          InkWell(
                            onTap: () {
                              showQrDialog(Config.imageURLPath + orderProduc["upi_image"].toString());
                            },
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: linercolor,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.qr_code_2, color: whitecolor, size: 18),
                                  const SizedBox(width: 5),
                                  Text(
                                    "Show QR".tr,
                                    style: TextStyle(
                                      color: whitecolor,
                                      fontSize: 13,
                                      fontFamily: 'Gilroy_Bold',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),*/
                      ],
                    ),
                  ),

                  SizedBox(height: 10),
                  Container(
                    width: Get.width,
                    padding: EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: linercolor,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Column(
                              mainAxisAlignment: MainAxisAlignment.start,
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                Image.asset(
                                  "assets/radio.png",
                                  height: 28,
                                  color: orangecolor,
                                ),
                                SizedBox(height: 3),
                                DottedLine(
                                  dashGapLength: 5,
                                  lineThickness: 2,
                                  dashColor: whitecolor.withOpacity(0.8),
                                  dashGapColor: Colors.transparent,
                                  direction: Axis.vertical,
                                  lineLength: orderProduc != null
                                      ? (orderProduc["customer_dmobile"] == null
                                      ? 60
                                      : 90)
                                      : 0,
                                ),
                                Image.asset(
                                  "assets/location_drop.png",
                                  height: 28,
                                  color: whitecolor,
                                ),
                              ],
                            ),
                            SizedBox(width: 10),
                            orderProduc == null
                                ? SizedBox()
                                : Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    orderProduc["pick_type"] == "Store"
                                        ? "${orderProduc["pick_name"]} - ${orderProduc["pick_type"]}"
                                        : (orderProduc["pick_type"] ?? "").toString(),
                                    style: TextStyle(
                                      color: whitecolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 16,
                                    ),
                                  ),
                                  Text(
                                    (orderProduc["customer_paddress"] ?? orderProduc["store_paddress"] ?? "").toString(),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      color: whitecolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 14,
                                    ),
                                  ),
                                  orderProduc["customer_pmobile"] == null
                                      ? SizedBox()
                                      : SizedBox(height: 8),
                                  orderProduc["customer_pmobile"] == null
                                      ? SizedBox()
                                      : addressCustomerdetails(
                                      name: orderProduc["customer_pname"],
                                      number: orderProduc["customer_pmobile"],
                                      textColor: whitecolor),
                                  SizedBox(height: 15),
                                  Text(
                                    (orderProduc["drop_type"] ?? "").toString(),
                                    style: TextStyle(
                                      color: whitecolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 16,
                                    ),
                                  ),
                                  Text(
                                    orderProduc["customer_daddress"] ?? "",
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      color: whitecolor.withOpacity(0.8),
                                      fontFamily: 'Gilroy_Medium',
                                      fontSize: 14,
                                    ),
                                  ),
                                  SizedBox(height: 8),
                                  orderProduc["customer_dmobile"] == null
                                      ? addressCustomerdetails(
                                    name: orderProduc["drop_name"],
                                    number: orderProduc["drop_mobile"],
                                    textColor: whitecolor,
                                  )
                                      : addressCustomerdetails(
                                    name: orderProduc["customer_dname"],
                                    number: orderProduc["customer_dmobile"],
                                    textColor: whitecolor,
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  //! Attachment
                  widget.type == "Pickup"
                      ? orderProduc != null
                      ? ((orderProduc["photos"] as List?)?.isNotEmpty ?? false) && orderProduc["photos"][0] != ""
                      ? SizedBox(height: 10)
                      : SizedBox()
                      : SizedBox()
                      : SizedBox(),
                  widget.type == "Pickup"
                      ? orderProduc != null
                      ? ((orderProduc["photos"] as List?)?.isNotEmpty ?? false) && orderProduc["photos"][0] != ""
                      ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "Package Attachment".tr,
                        style: TextStyle(
                          color: notifier.text,
                          fontSize: 18,
                          fontFamily: "Gilroy_Bold",
                        ),
                      ),
                      SizedBox(height: 10),
                      Container(
                        height: 100,
                        width: Get.width,
                        decoration: BoxDecoration(),
                        child: ListView.separated(
                          shrinkWrap: true,
                          clipBehavior: Clip.none,
                          scrollDirection: Axis.horizontal,
                          itemCount: orderProduc["photos"].length,
                          itemBuilder: (context, i) {
                            return attachment(orderProduc["photos"], i);
                          },
                          separatorBuilder: (BuildContext context, int index) => SizedBox(width: 10),
                        ),
                      ),
                      SizedBox(height: Get.height / 100),
                    ],
                  )
                      : SizedBox()
                      : SizedBox()
                      : SizedBox(),

                  if (orderProduc != null)...[
                    if(orderProduc["description"] != null)...[
                      SizedBox(height: 10),
                      Text(
                        "Package Info",
                        style: TextStyle(
                          color: notifier.text,
                          fontSize: 16,
                          fontFamily: "Gilroy_Bold",
                        ),
                      ),
                      SizedBox(height: 5),
                      Container(
                        width: Get.width,
                        padding: EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: notifier.getBgColor,
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: Text(
                          "${orderProduc["description"]}",
                          style: TextStyle(
                            color: greaycolor,
                            fontSize: 15,
                            fontFamily: "Gilroy_Medium",
                          ),
                        ),
                      ),
                    ],
                    widget.type != "Pickup"
                        ? orderProduc["item_list"].isNotEmpty
                        ? SizedBox(height: 10)
                        : SizedBox()
                        : SizedBox(height: 0),
                    //! itemlist
                    widget.type != "Pickup"
                        ? orderProduc["item_list"].isNotEmpty
                        ? Text(
                      "Order Items".tr,
                      style: TextStyle(
                        color: notifier.text,
                        fontSize: 18,
                        fontFamily: "Gilroy_Bold",
                      ),
                    )
                        : SizedBox()
                        : SizedBox(),
                  ],
                  widget.type != "Pickup"
                      ? SizedBox(height: 10)
                      : SizedBox(),
                  widget.type != "Pickup" && buyMapinfo != null
                      ? buyMapinfo["item_list"].isNotEmpty
                      ? buyMapinfo["item_list"][0]["item_img"][0] != null && buyMapinfo["item_list"][0]["item_img"][0] != ""
                      ? SizedBox(
                    width: Get.width,
                    height: 290,
                    child: ListView.separated(
                      shrinkWrap: true,
                      physics: BouncingScrollPhysics(),
                      itemCount: buyMapinfo["item_list"].length,
                      scrollDirection: Axis.horizontal,
                      padding: EdgeInsets.zero,
                      clipBehavior: Clip.none,
                      itemBuilder: (ctx, i) {
                        return InkWell(
                          onTap: () {
                            Get.to(
                                  () => TrakingView(
                                itemlength: buyMapinfo["item_list"].length.toString(),
                                imageList: buyMapinfo["item_list"][i]["item_img"],
                                itemID: buyMapinfo["item_list"][i]["item_id"],
                                type: buyMapinfo["item_list"][i]["item_confirm"],
                              ),
                            )!.then((value) {
                              setState(() {});
                              buyMapinfoget();
                            });
                          },
                          child: Container(
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
                                buyMapinfo["item_list"][i]["item_img"][0] != null && buyMapinfo["item_list"][i]["item_img"][0] != ""
                                    ? Expanded(
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(13),
                                    child: FadeInImage(
                                      width: Get.width / 2.5,
                                      placeholder: AssetImage("assets/ezgif.com-crop.gif"),
                                      image: NetworkImage(
                                        "${Config.imageURLPath}${buyMapinfo["item_list"][i]["item_img"][0]}",
                                      ),
                                      fit: BoxFit.cover,
                                    ),
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
                                        buyMapinfo["item_list"][i]["item_title"],
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontFamily: 'Gilroy_Medium',
                                          color: greaycolor,
                                        ),
                                      ),
                                    ),
                                    Text(
                                      "${buyMapinfo["item_list"][i]["quantity"]}",
                                      style: TextStyle(
                                        fontFamily: 'Gilroy_Medium',
                                        color: greaycolor,
                                      ),
                                    ),
                                  ],
                                ),
                                Divider(color: lightgrey),
                                buyMapinfo["item_list"][i]["item_total"] != null
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
                                      "$currency${buyMapinfo["item_list"][i]["item_total"] ?? "0"}",
                                      style: TextStyle(
                                        fontFamily: 'Gilroy_Medium',
                                        color: greaycolor,
                                      ),
                                    ),
                                  ],
                                )
                                    : SizedBox(height: 0),
                                SizedBox(height: 10),
                                buyMapinfo["order_step"] <= 6
                                    ? buyMapinfo["item_list"][i]["item_confirm"] != "2"
                                    ? InkWell(
                                  onTap: () {
                                    Get.to(
                                          () => TrakingView(itemlength: buyMapinfo["item_list"].length.toString(),
                                        imageList: buyMapinfo["item_list"][i]["item_img"],
                                        itemID: buyMapinfo["item_list"][i]["item_id"],
                                        orderID: orderProduc["order_id"],
                                        type: buyMapinfo["item_list"][i]["item_confirm"],
                                      ),
                                    )!.then((value) {
                                      setState(() {});
                                      buyMapinfoget();
                                      buyorderDetail();
                                    });
                                  },
                                  child: Container(
                                    padding: EdgeInsets.symmetric(vertical: 8),
                                    decoration: BoxDecoration(
                                      color: buyMapinfo["item_list"][i]["item_confirm"] != "0"
                                          ? greencolor
                                          : linercolor,
                                      borderRadius: BorderRadius.circular(11),
                                    ),
                                    child: Center(
                                      child: Text(
                                        buyMapinfo["item_list"][i]["item_confirm"] != "0"
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
                                    var contain = buyMapinfo["item_list"].where((element) => element["item_confirm"] == "2");
                                    if (contain.length == buyMapinfo["item_list"].length) {
                                      dialogShow(buyMapinfo["item_list"][i]["item_id"]);
                                    } else {
                                      itemConfirm(buyMapinfo["item_list"][i]["item_id"]);
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
                                )
                                    : SizedBox(),
                              ],
                            ),
                          ),
                        );
                      },
                      separatorBuilder: (BuildContext context, int index) => SizedBox(width: 10),
                    ),
                  )
                      : Container(
                    padding: EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      color: notifier.getBgColor,
                    ),
                    child: Column(
                      children: [
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
                        Divider(color: lightgrey),
                        ListView.separated(
                          shrinkWrap: true,
                          itemCount: orderProduc["item_list"].length,
                          physics: NeverScrollableScrollPhysics(),
                          itemBuilder: (context, index) {
                            return Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    orderProduc["item_list"][index]["item_title"],
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontFamily: 'Gilroy_Medium',
                                      color: greaycolor,
                                    ),
                                  ),
                                ),
                                Text(
                                  "${orderProduc["item_list"][index]["quantity"]} ",
                                  style: TextStyle(
                                    fontFamily: 'Gilroy_Medium',
                                    color: greaycolor,
                                  ),
                                ),
                              ],
                            );
                          },
                          separatorBuilder: (BuildContext context, int index) => SizedBox(height: 5),
                        ),
                      ],
                    ),
                  )
                      : SizedBox()
                      : SizedBox(),

                  if(orderProduc != null)...[

                    widget.type != "Pickup"
                        ? orderProduc["item_list"].isNotEmpty
                        ? SizedBox(height: 10)
                        : SizedBox()
                        : SizedBox(),
                    orderProduc["bill_img"] != null
                        ? Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Store bill receipt".tr,
                          style: TextStyle(
                            color: notifier.text,
                            fontSize: 18,
                            fontFamily: "Gilroy_Bold",
                          ),
                        ),
                        SizedBox(height: 10),
                        InkWell(
                          onTap: () {
                            List billImage = [];
                            billImage.add(orderProduc["bill_img"]);
                            Get.to(TrakingView(imageList: billImage));
                          },
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(15),
                            child: FadeInImage(
                              placeholder: AssetImage(
                                "assets/ezgif.com-crop.gif",
                              ),
                              placeholderFit: BoxFit.cover,
                              image: NetworkImage(
                                Config.imageURLPath +
                                    orderProduc["bill_img"],
                              ),
                              height: 170,
                              width: 170,
                              fit: BoxFit.cover,
                            ),
                          ),
                        ),
                      ],
                    )
                        : SizedBox(),
                    orderProduc["bill_img"] != null
                        ? SizedBox(height: 10)
                        : SizedBox(),

                    //! deliver Rider details
                   if (orderProduc["payment_status"] != null && orderProduc["payment_status"].toString() == "1")
                    if (orderProduc["rider_img"] != null)...[
                      SizedBox(height: 10),
                      Text(
                        "Rider details",
                        style: TextStyle(
                          color: notifier.text,
                          fontSize: 18,
                          fontFamily: "Gilroy_Bold",
                        ),
                      ),
                      SizedBox(height: 10),
                      Container(
                        padding: EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: notifier.getBgColor,
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: Row(
                          children: [
                            Container(
                              height: 55,
                              width: 55,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(50),
                                image: DecorationImage(
                                  image: NetworkImage(
                                    Config.imageURLPath + orderProduc["rider_img"],
                                  ),
                                  fit: BoxFit.fill,
                                ),
                              ),
                            ),
                            SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    orderProduc["rider_name"] ?? "",
                                    style: TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 18,
                                      color: notifier.text,
                                    ),
                                  ),
                                  SizedBox(height: 5),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.start,
                                    children: [
                                      Icon(
                                        Icons.star,
                                        color: Color(0xffFFC96E),
                                        size: 20,
                                      ),
                                      SizedBox(width: 5),
                                      Text(
                                        orderProduc["rider_star"].toString(),
                                        style: TextStyle(
                                          color: greaycolor.withOpacity(0.8),
                                          fontSize: 15,
                                          fontFamily: 'Gilroy_Medium',
                                        ),
                                      ),
                                    ],
                                  ),
                                  if (orderProduc["vehicle_no"] != null &&
                                      orderProduc["vehicle_no"].toString().isNotEmpty) ...[
                                    SizedBox(height: 3),
                                    Text(
                                      "${"Vehicle No".tr}: ${orderProduc["vehicle_no"]}",
                                      style: TextStyle(
                                        color: greaycolor.withOpacity(0.8),
                                        fontSize: 13,
                                        fontFamily: 'Gilroy_Medium',
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            (orderProduc["Order_Status"] == "Completed"
                                ?  SizedBox()
                                :  InkWell(
                              onTap: () async {
                                await FlutterPhoneDirectCaller.callNumber(orderProduc["rider_mobile"]);
                                debugPrint("============= receiverId ========== ${orderProduc["rider_mobile"]}");
                              },
                              child: Container(
                                padding: EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: notifier.lightBgColor,
                                ),
                                child: Center(
                                  child: Image.asset(
                                    "assets/fillcall.png",
                                    height: 25,
                                    color: linercolor,
                                  ),
                                ),
                              ),
                            )),
                            /*if (orderProduc["upi_image"] != null &&
                                orderProduc["upi_image"].toString().isNotEmpty) ...[
                              SizedBox(width: 8),
                              InkWell(
                                onTap: () {
                                  showQrDialog(Config.imageURLPath + orderProduc["upi_image"].toString());
                                },
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: linercolor,
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.qr_code_2, color: whitecolor, size: 16),
                                      const SizedBox(width: 4),
                                      Text(
                                        "Show QR".tr,
                                        style: TextStyle(
                                          color: whitecolor,
                                          fontSize: 12,
                                          fontFamily: 'Gilroy_Bold',
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],*/
                            isFavoriteLoading
                                ? SizedBox(
                              height: 25,
                              width: 25,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: linercolor,
                              ),
                            )
                                : InkWell(
                              onTap: () => toggleFavoriteDriver(),
                              child: Container(
                                padding: EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: notifier.lightBgColor,
                                ),
                                child: Center(
                                  child: Icon(
                                    isFavorite
                                        ? Icons.favorite
                                        : Icons.favorite_border,
                                    color: isFavorite
                                        ? Colors.red
                                        : linercolor,
                                    size: 22,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    orderProduc["Order_Status"] == "Cancelled"
                        ? SizedBox()
                        : SizedBox(height: 10),
                    orderProduc["Order_Status"] == "Cancelled"
                        ? SizedBox()
                        : Text(
                      "You're order current Status",
                      style: TextStyle(
                        color: notifier.text,
                        fontSize: 17,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                    orderProduc["Order_Status"] == "Cancelled"
                        ? SizedBox()
                        : SizedBox(height: 10),
                    orderProduc["Order_Status"] == "Cancelled"
                        ? SizedBox()
                        : Container(
                      width: Get.width,
                      padding: EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: notifier.getBgColor,
                        borderRadius: BorderRadius.circular(15),
                      ),
                      child: buyMapinfo == null
                          ? SizedBox()
                          : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            "${buyMapinfo["rest_msg"]}" ,
                            style: TextStyle(
                              color: notifier.text,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 16,
                            ),
                          ),
                          buyMapinfo["rider_msg"] != null
                              ? SizedBox(height: 4)
                              : SizedBox(),
                          buyMapinfo["rider_msg"] != null
                              ? Text(
                            buyMapinfo["rider_msg"],
                            style: TextStyle(
                              color: greaycolor.withOpacity(0.8),
                              fontFamily: 'Gilroy_Medium',
                            ),
                          )
                              : SizedBox(),
                        ],
                      ),
                    ),

                    SizedBox(height: 10),
                    //! --------------------- Order Details ----------------------
                    Text(
                      "Payment details".tr,
                      style: TextStyle(
                        color: notifier.text,
                        fontSize: 18,
                        fontFamily: "Gilroy_Bold",
                      ),
                    ),
                    SizedBox(height: 10),
                    Container(
                      padding: EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: notifier.getBgColor,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Column(
                        children: [
                          packagedetails(
                            packagename: "Payment Method".tr,
                            items: orderProduc["p_method_name"] ?? "",
                            colors: notifier.text,
                          ),
                          packagedetails(
                            packagename: "Order Status".tr,
                            items: orderProduc["Order_Status"] ?? "",
                            colors: greaycolor.withOpacity(0.8),
                          ),
                          orderProduc["total_item"] != null
                              ? orderProduc["total_item"] != 0
                              ? packagedetails(
                            packagename: "Total Item".tr,
                            items: "${orderProduc["total_item"]}",
                            colors: greaycolor.withOpacity(0.8),
                          )
                              : SizedBox()
                              : SizedBox(),
                          orderProduc["category"] != null
                              ? packagedetails(
                            packagename: "Package Details".tr,
                            items: orderProduc["category"] ?? "",
                            colors: greaycolor.withOpacity(0.8),
                          )
                              : SizedBox(),
                          packagedetails(
                            packagename: "Delivery Fees".tr,
                            items: "${orderProduc["Delivery_charge"] ?? "0"}$currency",
                            colors: greaycolor.withOpacity(0.8),
                          ),
                         /* orderProduc["package_cost"] != "0" && orderProduc["package_cost"] != null
                              ? packagedetails(
                              packagename: "Package Rate",
                              items: "${orderProduc["package_cost"]}$currency",
                              colors: greaycolor.withOpacity(0.8))
                              : SizedBox(),*/
                          orderProduc["extra_mile_charge"] != "0" &&
                              orderProduc["extra_mile_charge"] != null
                              ? packagedetails(
                              packagename: "Extra Mile Charge".tr,
                              items:
                              "${orderProduc["extra_mile_charge"]}$currency",
                              colors: greaycolor.withOpacity(0.8))
                              : SizedBox(),
                          orderProduc["service_bill"] != "0" && orderProduc["service_bill"] != null
                              ? packagedetails(
                            packagename: "${"Service Bill".tr} ",
                            subtitel: buyMapinfo["order_step"] <= 6
                                ? "(Unpaid)"
                                : "",
                            items: "${orderProduc["service_bill"]}$currency",
                            colors: greaycolor.withOpacity(0.8),
                          )
                              : SizedBox(),
                          orderProduc["service_charge"] != "0" &&
                              orderProduc["service_charge"] != null
                              ? packagedetails(
                              packagename: "Service Charge".tr,
                              subtitel: buyMapinfo["order_step"] <= 6
                                  ? "(Unpaid)"
                                  : "",
                              items: "${orderProduc["service_charge"]}$currency",
                              colors: greaycolor.withOpacity(0.8))
                              : SizedBox(),
                          orderProduc["cou_amt"] != "0" && orderProduc["cou_amt"] != null
                              ? packagedetails(
                            packagename: "Coupon Discount",
                            items: "- ${orderProduc["cou_amt"] ?? "0"}$currency",
                            colors: greencolor,
                          )
                              : SizedBox(),
                          Divider(
                              indent: 10, endIndent: 10, color: greaycolor),
                          buyMapinfo != null && buyMapinfo["order_step"] == 6
                              ? packagedetails(
                            packagename: "Pay Amount",
                            subtitel: buyMapinfo["order_step"] <= 6
                                ? "(Unpaid)"
                                : "",
                            items: "${grandTotal ?? "0"}$currency",
                            colors: greaycolor,
                            titleColor: greaycolor,
                          )
                              : SizedBox(),
                          orderProduc["grand_total"] != "0"
                              ? packagedetails(
                            packagename: "Grand Total",
                            items: "${orderProduc["grand_total"] ?? "0"}$currency",
                            titleColor: notifier.text,
                            colors: notifier.text,
                          )
                              : packagedetails(
                            packagename: "Total Delivery Fees".tr,
                            items:
                            "${orderProduc["total_Delivery_charge"] ?? "0"}$currency",
                            titleColor: notifier.text,
                            colors: notifier.text,
                          ),
                        ],
                      ),
                    ),
                    // Keep the total clear of the fixed Order Cancel action at the bottom.
                    SizedBox(height: Get.height / 7),

                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  ));
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
                "${Config.imageURLPath}${item[i]["item_img"][0]}",
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
            image: NetworkImage(Config.imageURLPath + image[i]),
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
    ApiWrapper.dataPost(Config.buyorderlist, data)!.then((val) {
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
    ApiWrapper.dataPost(Config.buyrate, data)!.then((val) {
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
      final val = await ApiWrapper.dataPost(Config.addFavoriteDriver, data);
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

    debugPrint("========== buymapinfo url ============ ${Config.baseurl + Config.buymapinfo}");
    debugPrint("========== buymapinfo data =========== $data");
    ApiWrapper.dataPost(Config.buymapinfo, data)!.then(
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
    ApiWrapper.dataPost(Config.confirmitem, data).then((val) {
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
              ApiWrapper.dataPost(Config.cancelReason, {"type": "user"})!.then((val) {
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
    ApiWrapper.dataPost(Config.buycancle, data)!.then((val) {
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
    ApiWrapper.dataPost(Config.itemRemove, data)!.then(
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
                        key: "rzp_test_Rr8n8p41taq6fM", // Test Razorpay key ID
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
                                    child: Image.network(
                                      "${Config.imageURLPath}${paymentGatwayApiModel!.data![index].img}",
                                    ),
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
    ApiWrapper.dataPost(Config.paybill, body)!.then((val) {
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
    ApiWrapper.dataGet(Config.paymentgateway)!.then((val) {
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
    ApiWrapper.dataPost(Config.mapinfo, data)!.then((val) {
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

    Map body = {
      "order_id": orderIdToUse,
      "uid": uid,
    };

    setState(() {
      isInvoiceLoading = true;
    });

    try {
      var value = await ApiWrapper.dataPost(Config.generateInvoiceUrl, body);
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

  showAdvancePaymentDialog() {
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

                  // Return to the current app shell; the latest booking flow
                  // is available from Home and the old PickUpDrop flow is no
                  // longer an entry point.
                  Get.offAll(() => const Bottombar());
                  Get.to(() => const WalletPage());
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
                                "Advance Amount".tr,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Bold',
                                  fontSize: 15,
                                ),
                              ),
                              Text(
                                "$paymentCurrency$advanceAmount",
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
                            _advanceTimer?.cancel();
                            _advanceTimer = null;
                            isAdvanceDialogOpened = false;
                            Navigator.of(context, rootNavigator: true).pop();
                            setState(() {
                              grandTotal = advanceAmount;
                            });
                            _payAdvanceWithRazorpay(advanceAmount);
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

    ApiWrapper.dataPost(Config.createOrder, data).then((val) {
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

    ApiWrapper.dataPost(Config.advancedPayment, body)!.then((val) async {
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
