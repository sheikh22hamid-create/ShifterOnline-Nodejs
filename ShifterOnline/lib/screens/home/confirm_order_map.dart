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
import '../../utils/colors.dart';
import 'wallet_page.dart';

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
  final Function(int payValue, String paymentTitle) onConfirmPayment;
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
  int _selectedPaymentMethod = 2; // 1 for Wallet, 2 for COD (Default Cash)

  bool _isLoadingPaymentSettings = true;
  int _paymentCod = 1;
  int _paymentWallet = 1;
  int _paymentOnline = 1;

  @override
  void initState() {
    super.initState();
    _initMap();
    _fetchPaymentStatus();
  }

  Future<void> _fetchPaymentStatus() async {
    try {
      final response = await ApiWrapper.dataGet(Config.paymentStatus);
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
        widget.onConfirmPayment(-2, "Wallet");
        Future.delayed(const Duration(seconds: 15), () {
          if (mounted) setState(() => _isProcessing = false);
        });
      } else {
        ApiWrapper.showToastMessage("Insufficient wallet balance. Please add money or choose Cash.".tr);
      }
    } else if (_selectedPaymentMethod == 2 && _paymentCod == 1) {
      setState(() => _isProcessing = true);
      widget.onConfirmPayment(1, "Cash");
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
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Confirm Booking",
              style: TextStyle(
                color: notifier.text,
                fontFamily: 'Gilroy_Bold',
                fontSize: 18,
              ),
            ),
            Text(
              "Review route & select payment method",
              style: TextStyle(
                color: greaycolor,
                fontFamily: 'Gilroy_Medium',
                fontSize: 12,
              ),
            ),
          ],
        ),
        backgroundColor: notifier.lightBgColor,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded, color: notifier.text),
          onPressed: () => Get.back(),
        ),
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
            Container(
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
                  // Drag Handle
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: greaycolor.withOpacity(0.3),
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),

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
                        onTap: () => setState(() => _selectedPaymentMethod = 1),
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
                                        "Add Money",
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
                  ],

                  const SizedBox(height: 14),

                  // Terms & Notice
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

                  // ── CONFIRM & PLACE ORDER BUTTON ──────────────────────────
                  SizedBox(
                    width: double.infinity,
                    height: 50,
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
                            ? Colors.amber.shade800
                            : linercolor,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      child: _isProcessing
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(
                                color: Colors.white,
                                strokeWidth: 2.4,
                              ),
                            )
                          : Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  (_selectedPaymentMethod == 1 && isWalletInsufficient)
                                      ? "Add Money to Wallet"
                                      : "Confirm & Place Order · ${widget.currency}${widget.deliveryFees.toStringAsFixed(2)}",
                                  style: const TextStyle(
                                    fontFamily: 'Gilroy_Bold',
                                    fontSize: 15,
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
          ],
        ),
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
    final notifier = Provider.of<ColorNotifier>(context, listen: false);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: isSelected ? linercolor.withOpacity(0.08) : notifier.getBgColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isSelected ? linercolor : notifier.bordecolor.withOpacity(0.8),
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            // Icon in circle
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: isSelected ? linercolor.withOpacity(0.18) : notifier.lightBgColor,
                shape: BoxShape.circle,
              ),
              child: Icon(
                icon,
                color: isSelected ? linercolor : greaycolor,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),

            // Title & Subtitle
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 13.5,
                      color: notifier.text,
                    ),
                  ),
                  const SizedBox(height: 1.5),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 11.5,
                      color: isSelected ? linercolor : greaycolor,
                    ),
                  ),
                ],
              ),
            ),

            if (trailing != null) ...[
              const SizedBox(width: 8),
              trailing,
            ] else ...[
              const SizedBox(width: 8),
              Icon(
                isSelected ? Icons.radio_button_checked : Icons.radio_button_off,
                color: isSelected ? linercolor : greaycolor.withOpacity(0.6),
                size: 21,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
