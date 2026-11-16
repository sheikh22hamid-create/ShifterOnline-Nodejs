import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:flutter_polyline_points/flutter_polyline_points.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../services/settlement_api_service.dart';
import '../../utils/colors.dart';
import '../../utils/receiver_pay_options.dart';
import 'wallet_page.dart';
import 'widgets/booking_guidelines.dart';
import '../../theme/app_tokens.dart';
import 'widgets/booking_option_widgets.dart';
import '../../theme/widgets/app_top_bar.dart';
import '../../theme/widgets/pressable_scale.dart';

class ConfirmOrderMap extends StatefulWidget {
  final double startLat;
  final double startLng;
  final double endLat;
  final double endLng;
  final List<Map<String, dynamic>> stops;
  final double deliveryFees;
  final double walletBalance;
  final String currency;
  final String deliveryType;
  final String? dropMobile;
  final Function(int payValue, String paymentTitle, ReceiverPaySelection receiverPay) onConfirmPayment;
  final VoidCallback onViewBreakup;

  const ConfirmOrderMap({
    Key? key,
    required this.startLat,
    required this.startLng,
    required this.endLat,
    required this.endLng,
    this.stops = const [],
    required this.deliveryFees,
    required this.walletBalance,
    required this.currency,
    required this.deliveryType,
    this.dropMobile,
    required this.onConfirmPayment,
    required this.onViewBreakup,
  }) : super(key: key);

  @override
  State<ConfirmOrderMap> createState() => _ConfirmOrderMapState();
}

class _ConfirmOrderMapState extends State<ConfirmOrderMap> {
  final Completer<GoogleMapController> _controller = Completer();
  GoogleMapController? _mapController;
  final PolylinePoints _polylinePoints = PolylinePoints();
  Set<Marker> _markers = {};
  Map<PolylineId, Polyline> _polylines = {};
  bool _isLoadingMap = true;
  bool _isProcessing = false;
  // Bottom panel collapsed = map gets (nearly) the full screen.
  bool _panelExpanded = true;
  int _selectedPaymentMethod = 2; // 1 for Wallet, 2 for COD (Default Cash)

  bool _isLoadingPaymentSettings = true;
  int _paymentCod = 1;
  int _paymentWallet = 1;
  int _paymentOnline = 1;

  // Receiver pays (cash only). Config failure keeps it disabled so booking
  // behaves exactly as before.
  ReceiverPayConfig _receiverConfig = ReceiverPayConfig.disabled;
  bool _receiverPays = false;
  double _receiverPercent = 0;

  // Effective payValue for the selected method: cash 1, wallet -2, else 0.
  int get _effectivePayValue =>
      _selectedPaymentMethod == 2 ? 1 : (_selectedPaymentMethod == 1 ? -2 : 0);

  String? get _receiverReason => receiverPayUnavailableReason(
        config: _receiverConfig,
        payValue: _effectivePayValue,
        dropMobile: widget.dropMobile,
      );

  Future<void> _fetchReceiverPayConfig() async {
    try {
      final cfg = await SettlementApiService.getReceiverPayConfig();
      if (mounted) setState(() => _receiverConfig = cfg);
    } catch (_) {
      // Keep disabled.
    }
  }

  @override
  void initState() {
    super.initState();
    _initMap();
    _fetchPaymentStatus();
    _fetchReceiverPayConfig();
    _fetchRestrictedItems();
    _fetchBookingGuidelines();
  }

  // Admin-managed "Important Booking Guidelines" (Booking Guidelines page).
  // Null until loaded / if the call fails, in which case the built-in
  // defaults below are shown so the section is never empty.
  List<String>? _bookingGuidelines;

  Future<void> _fetchBookingGuidelines() async {
    try {
      final response = await ApiWrapper.dataGetNode(Config.nodeBookingGuidelines);
      if (response is Map && (response['Result'] == true || response['Result'] == 'true') && response['data'] is List) {
        final texts = (response['data'] as List)
            .whereType<Map>()
            .map((e) => (e['text'] ?? '').toString().trim())
            .where((t) => t.isNotEmpty)
            .toList();
        if (mounted) setState(() => _bookingGuidelines = texts);
      }
    } catch (_) {
      // Keep the default guideline text.
    }
  }

  // Admin-managed list of items that must not be sent (Restricted Items page).
  List<String> _restrictedItems = [];

  Future<void> _fetchRestrictedItems() async {
    try {
      final response = await ApiWrapper.dataGetNode(Config.nodeRestrictedItems);
      if (response is Map && (response['Result'] == true || response['Result'] == 'true') && response['data'] is List) {
        final names = (response['data'] as List)
            .whereType<Map>()
            .map((e) => (e['name'] ?? '').toString().trim())
            .where((n) => n.isNotEmpty)
            .toList();
        if (mounted) setState(() => _restrictedItems = names);
      }
    } catch (_) {
      // Keep the default guideline text.
    }
  }

  Future<void> _fetchPaymentStatus() async {
    try {
      final response = await ApiWrapper.dataPostNode(Config.nodePaymentStatus, {});
      if (response != null && response is Map<String, dynamic>) {
        if (response["ResponseCode"] == "200" && response["setting"] != null) {
          final setting = response["setting"];
          if (mounted) {
            setState(() {
              _paymentCod = int.tryParse(setting["payment_cod"]?.toString() ?? "1") ?? 1;
              _paymentWallet = int.tryParse(setting["payment_wallet"]?.toString() ?? "1") ?? 1;
              _paymentOnline = int.tryParse(setting["payment_online"]?.toString() ?? "1") ?? 1;

              if (_paymentCod == 1) {
                _selectedPaymentMethod = 2;
              } else if (_paymentWallet == 1) {
                _selectedPaymentMethod = 1;
              } else {
                _selectedPaymentMethod = 0;
              }
              if (_selectedPaymentMethod != 2) {
                _receiverPays = false;
                _receiverPercent = 0;
              }
            });
          }
        }
      }
    } catch (e) {
      debugPrint("Error fetching payment status: $e");
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingPaymentSettings = false;
        });
      }
    }
  }

  void _initMap() async {
    await _addMarkers();
    await _getDirections();
  }

  Future<BitmapDescriptor> _createNumberedPin({
    String? label,
    IconData? icon,
    required Color color,
  }) async {
    const size = 96.0;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);

    // Outer Circle Shadow
    final shadowPaint = Paint()
      ..color = Colors.black26
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);
    canvas.drawCircle(const Offset(size / 2, size / 2 + 3), 36, shadowPaint);

    // Main Circle Background
    final mainPaint = Paint()..color = color;
    canvas.drawCircle(const Offset(size / 2, size / 2), 36, mainPaint);

    // White Border
    final borderPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4;
    canvas.drawCircle(const Offset(size / 2, size / 2), 36, borderPaint);

    if (label != null && label.isNotEmpty) {
      final textPainter = TextPainter(
        text: TextSpan(
          text: label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 32,
            fontWeight: FontWeight.bold,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      textPainter.layout();
      textPainter.paint(
        canvas,
        Offset(
          (size - textPainter.width) / 2,
          (size - textPainter.height) / 2,
        ),
      );
    } else if (icon != null) {
      final textPainter = TextPainter(
        text: TextSpan(
          text: String.fromCharCode(icon.codePoint),
          style: TextStyle(
            inherit: false,
            color: Colors.white,
            fontSize: 38,
            fontFamily: icon.fontFamily,
            package: icon.fontPackage,
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      textPainter.layout();
      textPainter.paint(
        canvas,
        Offset(
          (size - textPainter.width) / 2,
          (size - textPainter.height) / 2,
        ),
      );
    }

    final image = await recorder.endRecording().toImage(size.toInt(), size.toInt());
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(byteData!.buffer.asUint8List());
  }

  Future<void> _addMarkers() async {
    final newMarkers = <Marker>{};

    // 1. Pickup Marker (Green Arrow Up)
    final pickupIcon = await _createNumberedPin(
      icon: Icons.arrow_upward_rounded,
      color: const Color(0xff10B981),
    );
    newMarkers.add(
      Marker(
        markerId: const MarkerId('pickup'),
        position: LatLng(widget.startLat, widget.startLng),
        icon: pickupIcon,
        infoWindow: const InfoWindow(title: 'Pickup Location'),
      ),
    );

    // 2. Intermediate Stops Markers (Numbered Brand Orange Pins)
    for (var index = 0; index < widget.stops.length; index++) {
      final stop = widget.stops[index];
      final lat = double.tryParse(stop['lat_map']?.toString() ?? '');
      final lng = double.tryParse(stop['long_map']?.toString() ?? '');
      if (lat == null || lng == null) continue;

      final stopIcon = await _createNumberedPin(
        label: "${index + 1}",
        color: linercolor,
      );
      newMarkers.add(
        Marker(
          markerId: MarkerId('stop_${index + 1}'),
          position: LatLng(lat, lng),
          icon: stopIcon,
          infoWindow: InfoWindow(title: 'Stop ${index + 1}'),
        ),
      );
    }

    // 3. Drop Marker (Red Arrow Down)
    final dropIcon = await _createNumberedPin(
      icon: Icons.arrow_downward_rounded,
      color: const Color(0xffEF4444),
    );
    newMarkers.add(
      Marker(
        markerId: const MarkerId('drop'),
        position: LatLng(widget.endLat, widget.endLng),
        icon: dropIcon,
        infoWindow: const InfoWindow(title: 'Drop Location'),
      ),
    );

    if (mounted) {
      setState(() {
        _markers = newMarkers;
      });
    }
  }

  List<LatLng> get _routeLocations {
    final locations = <LatLng>[
      LatLng(widget.startLat, widget.startLng),
    ];
    for (final stop in widget.stops) {
      final lat = double.tryParse(stop['lat_map']?.toString() ?? '');
      final lng = double.tryParse(stop['long_map']?.toString() ?? '');
      if (lat != null && lng != null) locations.add(LatLng(lat, lng));
    }
    locations.add(LatLng(widget.endLat, widget.endLng));
    return locations;
  }

  Future<void> _getDirections() async {
    try {
      List<LatLng> polylineCoordinates = [];

      final locations = _routeLocations;
      final waypoints = widget.stops
          .map((stop) => '${stop['lat_map']},${stop['long_map']}')
          .join('|');
      final url = Uri.parse(
        'https://maps.googleapis.com/maps/api/directions/json?'
        'origin=${locations.first.latitude},${locations.first.longitude}&'
        'destination=${locations.last.latitude},${locations.last.longitude}&'
        '${waypoints.isEmpty ? '' : 'waypoints=${Uri.encodeComponent(waypoints)}&'}'
        'mode=driving&'
        'key=${Config.googleApikey}',
      );

      final response = await http.get(url).timeout(const Duration(seconds: 12));
      final data = jsonDecode(response.body);
      if (data['status'] == 'OK' &&
          data['routes'] is List &&
          (data['routes'] as List).isNotEmpty) {
        final encodedPolyline = data['routes'][0]['overview_polyline']['points'];
        final decodedPoints = _polylinePoints.decodePolyline(encodedPolyline);
        polylineCoordinates.addAll(
          decodedPoints.map((point) => LatLng(point.latitude, point.longitude)),
        );
      }

      if (polylineCoordinates.isEmpty) {
        polylineCoordinates = locations;
      }

      _addPolyLine(polylineCoordinates);
      await _setCameraBounds(polylineCoordinates);
    } catch (e) {
      debugPrint("Error drawing route: $e");
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingMap = false;
        });
      }
    }
  }

  void _addPolyLine(List<LatLng> polylineCoordinates) {
    if (polylineCoordinates.isEmpty) return;

    final id = const PolylineId('route');
    final poly = Polyline(
      polylineId: id,
      color: linercolor,
      width: 5,
      points: polylineCoordinates,
      geodesic: true,
      startCap: Cap.roundCap,
      endCap: Cap.roundCap,
      jointType: JointType.round,
    );

    _polylines[id] = poly;
    if (mounted) setState(() {});
  }

  Future<void> _setCameraBounds(List<LatLng> polylineCoordinates) async {
    if (polylineCoordinates.isEmpty || _mapController == null) return;

    double swLat = polylineCoordinates.first.latitude;
    double swLng = polylineCoordinates.first.longitude;
    double neLat = polylineCoordinates.first.latitude;
    double neLng = polylineCoordinates.first.longitude;

    for (final p in polylineCoordinates) {
      if (p.latitude < swLat) swLat = p.latitude;
      if (p.latitude > neLat) neLat = p.latitude;
      if (p.longitude < swLng) swLng = p.longitude;
      if (p.longitude > neLng) neLng = p.longitude;
    }

    final bounds = LatLngBounds(
      southwest: LatLng(swLat, swLng),
      northeast: LatLng(neLat, neLng),
    );

    try {
      await _mapController!.animateCamera(
        CameraUpdate.newLatLngBounds(bounds, 70),
      );
    } catch (e) {
      debugPrint("SetCameraBounds error: $e");
    }
  }

  void _handleConfirmOrder() {
    if (_isProcessing) return;

    if (_selectedPaymentMethod == 1 && _paymentWallet == 1) {
      if (widget.walletBalance >= widget.deliveryFees) {
        setState(() => _isProcessing = true);
        // Receiver pays is never combined with wallet.
        widget.onConfirmPayment(-2, "Wallet", ReceiverPaySelection.off);
        Future.delayed(const Duration(seconds: 15), () {
          if (mounted) setState(() => _isProcessing = false);
        });
      } else {
        ApiWrapper.showToastMessage("Insufficient wallet balance. Please add money or choose Cash.".tr);
      }
    } else if (_selectedPaymentMethod == 2 && _paymentCod == 1) {
      setState(() => _isProcessing = true);
      final receiverOn = _receiverPays && _receiverReason == null;
      widget.onConfirmPayment(
        1,
        "Cash",
        ReceiverPaySelection(
          enabled: receiverOn,
          percent: receiverOn ? _receiverPercent : 0,
        ),
      );
      Future.delayed(const Duration(seconds: 15), () {
        if (mounted) setState(() => _isProcessing = false);
      });
    } else {
      ApiWrapper.showToastMessage("Please select a valid payment method.".tr);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notifier = Provider.of<ColorNotifier>(context, listen: true);
    final isWalletInsufficient = widget.walletBalance < widget.deliveryFees;

    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      appBar: AppTopBar(
        title: "Confirm Booking".tr,
        subtitle: "Review route & select payment method".tr,
        onBack: () => Get.back(),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            // ── TOP SECTION: MAP VIEW ───────────────────────────────────────
            Expanded(
              child: Stack(
                children: [
                  GoogleMap(
                    myLocationButtonEnabled: false,
                    zoomControlsEnabled: false,
                    mapType: MapType.normal,
                    polylines: Set<Polyline>.of(_polylines.values),
                    markers: _markers,
                    initialCameraPosition: CameraPosition(
                      target: LatLng(widget.startLat, widget.startLng),
                      zoom: 13.5,
                    ),
                    onMapCreated: (GoogleMapController controller) {
                      _mapController = controller;
                      if (!_controller.isCompleted) {
                        _controller.complete(controller);
                      }
                      Future<void>.delayed(const Duration(milliseconds: 400), () {
                        if (mounted) _setCameraBounds(_routeLocations);
                      });
                    },
                  ),

                  if (_isLoadingMap)
                    Positioned(
                      top: 14,
                      right: 14,
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: notifier.getBgColor.withOpacity(0.9),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: linercolor,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),

            // ── BOTTOM SECTION: PAYMENT & CONFIRMATION PANEL ────────────────
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.6),
              child: Container(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 16),
              decoration: BoxDecoration(
                color: notifier.getBgColor,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.08),
                    blurRadius: 18,
                    offset: const Offset(0, -4),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Drag handle / scroll toggle: tap or swipe to collapse the
                  // panel (map full screen) or expand it back (map half).
                  GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => setState(() => _panelExpanded = !_panelExpanded),
                    onVerticalDragEnd: (details) {
                      final v = details.primaryVelocity ?? 0;
                      if (v > 150 && _panelExpanded) setState(() => _panelExpanded = false);
                      if (v < -150 && !_panelExpanded) setState(() => _panelExpanded = true);
                    },
                    child: SizedBox(
                      width: double.infinity,
                      child: Column(
                        children: [
                          Icon(
                            _panelExpanded ? Icons.keyboard_arrow_down_rounded : Icons.keyboard_arrow_up_rounded,
                            color: greaycolor,
                            size: 26,
                          ),
                          Container(
                            width: 42,
                            height: 4,
                            decoration: BoxDecoration(
                              color: greaycolor.withOpacity(0.3),
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),

                  // ── FARE SUMMARY HEADER ROW ───────────────────────────────
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: notifier.lightBgColor,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              "Total Payable Fare",
                              style: TextStyle(
                                color: greaycolor,
                                fontFamily: 'Gilroy_Medium',
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              "${widget.currency}${widget.deliveryFees.toStringAsFixed(2)}",
                              style: TextStyle(
                                color: linercolor,
                                fontFamily: 'Gilroy_Bold',
                                fontSize: 20,
                              ),
                            ),
                          ],
                        ),

                        // View Breakup Pill Button
                        InkWell(
                          onTap: widget.onViewBreakup,
                          borderRadius: BorderRadius.circular(20),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6.5),
                            decoration: BoxDecoration(
                              color: linercolor.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: linercolor.withOpacity(0.3)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.info_outline_rounded, color: linercolor, size: 15),
                                const SizedBox(width: 5),
                                Text(
                                  "View Breakup",
                                  style: TextStyle(
                                    color: linercolor,
                                    fontFamily: 'Gilroy_Bold',
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_panelExpanded)
                  Flexible(
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                  const SizedBox(height: 16),

                  // ── PAYMENT METHODS SECTION ───────────────────────────────
                  Text(
                    "Select Payment Method",
                    style: TextStyle(
                      fontSize: 15,
                      color: notifier.text,
                      fontFamily: 'Gilroy_Bold',
                    ),
                  ),
                  const SizedBox(height: 10),

                  if (_isLoadingPaymentSettings)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Center(
                        child: CircularProgressIndicator(color: linercolor),
                      ),
                    )
                  else if (_paymentWallet == 0 && _paymentCod == 0)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 18),
                      child: Center(
                        child: Text(
                          "No payment methods available right now.",
                          style: TextStyle(
                            color: greaycolor,
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 13,
                          ),
                        ),
                      ),
                    )
                  else ...[
                    // 1. Cash On Delivery Option
                    if (_paymentCod == 1)
                      _buildPaymentOptionCard(
                        isSelected: _selectedPaymentMethod == 2,
                        icon: Icons.payments_rounded,
                        title: "Cash on Delivery",
                        subtitle: "Pay cash at pickup / drop location",
                        onTap: () => setState(() => _selectedPaymentMethod = 2),
                        trailing: null,
                      ),

                    if (_paymentCod == 1 && _paymentWallet == 1)
                      const SizedBox(height: 9),

                    // 2. Shifter Wallet Option
                    if (_paymentWallet == 1)
                      _buildPaymentOptionCard(
                        isSelected: _selectedPaymentMethod == 1,
                        icon: Icons.account_balance_wallet_rounded,
                        title: "Shifter Wallet",
                        subtitle: "Available: ${widget.currency}${widget.walletBalance.toStringAsFixed(2)}",
                        onTap: () => setState(() {
                          _selectedPaymentMethod = 1;
                          // Receiver pays is cash only.
                          _receiverPays = false;
                          _receiverPercent = 0;
                        }),
                        trailing: isWalletInsufficient
                            ? InkWell(
                                onTap: () => Get.to(() => const WalletPage()),
                                borderRadius: BorderRadius.circular(14),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4.5),
                                  decoration: BoxDecoration(
                                    color: linercolor.withOpacity(0.12),
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(color: linercolor.withOpacity(0.5)),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.add_rounded, color: linercolor, size: 14),
                                      const SizedBox(width: 2),
                                      Text(
                                        "Add Money".tr,
                                        style: TextStyle(
                                          color: linercolor,
                                          fontFamily: 'Gilroy_Bold',
                                          fontSize: 11,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              )
                            : null,
                      ),
                    if (_receiverConfig.enabled) ...[
                      const SizedBox(height: 9),
                      _buildReceiverPayCard(),
                    ],
                  ],

                  const SizedBox(height: 14),

                  // Terms & Notice
                  // ── BOOKING GUIDELINES / IMPORTANT NOTICE ─────────────
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: BookingGuidelines(
                      title: "Important Booking Guidelines".tr,
                      items: [
                        if (_bookingGuidelines == null) ...[
                          (icon: Icons.no_accounts_outlined, text: "Fare does not include loading / unloading labour charges.".tr),
                          (icon: Icons.local_parking_outlined, text: "Toll, state taxes & parking charges to be borne by customer.".tr),
                        ] else
                          for (final guideline in _bookingGuidelines!) (icon: Icons.info_outline_rounded, text: guideline),
                        (
                          icon: Icons.warning_amber_rounded,
                          text: _restrictedItems.isEmpty
                              ? "No toxic, hazardous, illegal, or explosive items permitted.".tr
                              : "${"Restricted items (not allowed):".tr} ${_restrictedItems.join(', ')}",
                        ),
                      ],
                    ),
                  ),

                  Center(
                    child: Text(
                      "By booking, you agree to our Terms of Service & Cancellation Policy",
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11,
                        color: greaycolor,
                        fontFamily: 'Gilroy_Medium',
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                        ],
                      ),
                    ),
                  ),
                  if (!_panelExpanded) const SizedBox(height: 10),

                  // ── CONFIRM & PLACE ORDER BUTTON ──────────────────────────
                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: ElevatedButton(
                      onPressed: (_isProcessing ||
                              (_paymentWallet == 0 && _paymentCod == 0) ||
                              _selectedPaymentMethod == 0 ||
                              (_selectedPaymentMethod == 1 && isWalletInsufficient))
                          ? (_selectedPaymentMethod == 1 && isWalletInsufficient
                              ? () => Get.to(() => const WalletPage())
                              : null)
                          : _handleConfirmOrder,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: (_selectedPaymentMethod == 1 && isWalletInsufficient)
                            ? Colors.amber.shade700
                            : AppPalette.current.brand,
                        foregroundColor: AppPalette.current.onBrand,
                        disabledBackgroundColor: AppPalette.current.brand.withValues(alpha: 0.4),
                        disabledForegroundColor: AppPalette.current.onBrand.withValues(alpha: 0.7),
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      child: _isProcessing
                          ? SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(
                                color: AppPalette.current.onBrand,
                                strokeWidth: 2.4,
                              ),
                            )
                          : Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Flexible(
                                  child: Text(
                                    (_selectedPaymentMethod == 1 && isWalletInsufficient)
                                        ? "Add Money to Wallet".tr
                                        : "${"Confirm & Place Order".tr} · ${widget.currency}${widget.deliveryFees.toStringAsFixed(2)}",
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 16,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                const Icon(Icons.arrow_forward_rounded, size: 18),
                              ],
                            ),
                    ),
                  ),
                ],
              ),
            ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildReceiverPayCard() {
    Provider.of<ColorNotifier>(context, listen: false);
    final pal = AppPalette.current;
    final reason = _receiverReason;
    final active = _receiverPays && reason == null;
    TextStyle note() => TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 12, height: 1.3, color: pal.inkSubtle);

    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
      decoration: BoxDecoration(
        color: active ? pal.brandTint : pal.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: active ? pal.brand : pal.line, width: active ? 1.5 : 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: active ? pal.surface : pal.canvas, shape: BoxShape.circle),
                child: Icon(Icons.person_pin_circle_rounded, color: active ? pal.brandText : pal.inkMuted, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Receiver pays".tr,
                      style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14, color: pal.ink),
                    ),
                    if (reason != null) ...[
                      const SizedBox(height: 2),
                      Text(reason.tr, style: note()),
                    ],
                  ],
                ),
              ),
              Switch(
                value: active,
                onChanged: reason != null
                    ? null
                    : (v) => setState(() {
                          _receiverPays = v;
                          if (!v) _receiverPercent = 0;
                        }),
              ),
            ],
          ),
          if (active) ...[
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 6),
                  Text(
                    "Receiver pays the fare at drop. Your advance is refunded to your wallet when they pay.".tr,
                    style: note(),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    "Your commission (added to the receiver's total)".tr,
                    style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 13, color: pal.ink),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: percentChoices(_receiverConfig.maxPercent).map((p) {
                      final label = p == p.roundToDouble() ? "${p.toInt()}%" : "${p.toStringAsFixed(1)}%";
                      return BookingChoicePill(
                        label: label,
                        selected: _receiverPercent == p,
                        onTap: () => setState(() => _receiverPercent = p),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 10),
                  Text("Commission applies whether the receiver pays cash or online.".tr, style: note()),
                  const SizedBox(height: 4),
                  Text("Receiver gets a WhatsApp link to pay (no app needed).".tr, style: note()),
                  const SizedBox(height: 2),
                  Text(
                    "+91 ${normalizeIndianMobile(widget.dropMobile)}",
                    style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 13, color: pal.brandText),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPaymentOptionCard({
    required bool isSelected,
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    Widget? trailing,
  }) {
    final p = AppPalette.current;

    return Semantics(
      selected: isSelected,
      inMutuallyExclusiveGroup: true,
      child: PressableScale(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? p.brandTint : p.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: isSelected ? p.brand : p.line, width: isSelected ? 1.5 : 1),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: isSelected ? p.surface : p.canvas,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: isSelected ? p.brand : p.inkMuted, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title.tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: AppText.caption(p.inkMuted)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (trailing != null) ...[
                trailing,
              ] else
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: p.surface,
                    border: Border.all(color: isSelected ? p.brand : p.line, width: isSelected ? 6 : 2),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
