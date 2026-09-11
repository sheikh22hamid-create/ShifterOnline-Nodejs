import 'dart:async';
import 'dart:convert';

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
  PolylinePoints polylinePoints = PolylinePoints();
  Set<Marker> markers = {};
  Map<PolylineId, Polyline> polylines = {};
  bool isLoadingmap = true;
  bool isProcessing = false;
  int selectedPaymentMethod = 2; // 1 for Wallet, 2 for COD (Default Cash)
  late ColorNotifier notifier;

  bool isLoadingPaymentSettings = true;
  int paymentCod = 1;
  int paymentWallet = 1;
  int paymentOnline = 1;

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
              paymentCod = int.tryParse(setting["payment_cod"]?.toString() ?? "1") ?? 1;
              paymentWallet = int.tryParse(setting["payment_wallet"]?.toString() ?? "1") ?? 1;
              paymentOnline = int.tryParse(setting["payment_online"]?.toString() ?? "1") ?? 1;

              // Auto-select initial payment method based on active settings (Default Cash)
              if (paymentCod == 1) {
                selectedPaymentMethod = 2;
              } else if (paymentWallet == 1) {
                selectedPaymentMethod = 1;
              } else {
                selectedPaymentMethod = 0;
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
          isLoadingPaymentSettings = false;
        });
      }
    }
  }

  void _initMap() async {
    _addMarkers();
    await _getDirections();
  }

  void _addMarkers() {
    markers.add(
      Marker(
        markerId: const MarkerId('pickup'),
        position: LatLng(widget.startLat, widget.startLng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
        infoWindow: const InfoWindow(title: 'Pickup'),
      ),
    );

    for (var index = 0; index < widget.stops.length; index++) {
      final stop = widget.stops[index];
      final lat = double.tryParse(stop['lat_map']?.toString() ?? '');
      final lng = double.tryParse(stop['long_map']?.toString() ?? '');
      if (lat == null || lng == null) continue;
      markers.add(
        Marker(
          markerId: MarkerId('stop_${index + 1}'),
          position: LatLng(lat, lng),
          icon: BitmapDescriptor.defaultMarkerWithHue(
            index == 0
                ? BitmapDescriptor.hueOrange
                : BitmapDescriptor.hueAzure,
          ),
          infoWindow: InfoWindow(title: 'Stop ${index + 1}'),
        ),
      );
    }

    markers.add(
      Marker(
        markerId: const MarkerId('drop'),
        position: LatLng(widget.endLat, widget.endLng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
        infoWindow: const InfoWindow(title: 'Drop'),
      ),
    );
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
          'key=${Config.googleApikey}');

      final response = await http.get(url);
      final data = jsonDecode(response.body);
      if (data['status'] == 'OK' &&
          data['routes'] is List &&
          (data['routes'] as List).isNotEmpty) {
        final encodedPolyline = data['routes'][0]['overview_polyline']['points'];
        final decodedPoints = polylinePoints.decodePolyline(encodedPolyline);
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
          isLoadingmap = false;
        });
      }
    }
  }

  void _addPolyLine(List<LatLng> polylineCoordinates) {
    if (polylineCoordinates.isEmpty) return;

    final id = const PolylineId('route');
    final poly = Polyline(
      polylineId: id,
      color: const Color(0xFF4285F4),
      width: 6,
      points: polylineCoordinates,
      geodesic: true,
      startCap: Cap.roundCap,
      endCap: Cap.roundCap,
      jointType: JointType.round,
    );

    polylines[id] = poly;
    if (mounted) setState(() {});
  }

  Future<void> _setCameraBounds(List<LatLng> polylineCoordinates) async {
    if (polylineCoordinates.isEmpty) return;

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

    final currentController = _mapController;
    if (currentController != null) {
      try {
        await currentController.animateCamera(
            CameraUpdate.newLatLngBounds(bounds, 145));
      } catch (e) {
        debugPrint("SetCameraBounds error: $e");
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of<ColorNotifier>(context, listen: true);
    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      appBar: AppBar(
        title: Text(
          "Confirm Order",
          style: TextStyle(
            color: notifier.text,
            fontFamily: 'Gilroy_Bold',
          ),
        ),
        backgroundColor: notifier.lightBgColor,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: notifier.text),
          onPressed: () => Get.back(),
        ),
      ),
      body: Column(
        children: [
          // Upper half for map
          Expanded(
            child: Stack(
              children: [
                GoogleMap(
                  myLocationButtonEnabled: false,
                  zoomControlsEnabled: false,
                  mapType: MapType.normal,
                  polylines: Set<Polyline>.of(polylines.values),
                  markers: markers,
                  initialCameraPosition: CameraPosition(
                    target: LatLng(widget.startLat, widget.startLng),
                    zoom: 14.0,
                  ),
                  onMapCreated: (GoogleMapController controller) {
                    _mapController = controller;
                    if (!_controller.isCompleted) {
                      _controller.complete(controller);
                    }
                    // The directions request can finish before GoogleMap has
                    // created its controller. Fit the whole ordered route
                    // again once the map is ready so pickup, every stop and
                    // the final drop are visible together.
                    Future<void>.delayed(const Duration(milliseconds: 500), () {
                      if (mounted) _setCameraBounds(_routeLocations);
                    });
                    if (mounted) setState(() {});
                  },
                ),
                if (isLoadingmap)
                  Center(child: CircularProgressIndicator(color: linercolor)),
              ],
            ),
          ),
          
          // Bottom half for payment
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: notifier.lightBgColor,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(24),
                topRight: Radius.circular(24),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.05),
                  blurRadius: 10,
                  offset: const Offset(0, -5),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Text(
                    "Select Payment Method".tr,
                    style: TextStyle(
                      fontSize: 20,
                      color: notifier.text,
                      fontFamily: 'Gilroy_Bold',
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  "Payment Methods".tr,
                  style: TextStyle(
                    fontSize: 16,
                    color: notifier.text,
                    fontFamily: 'Gilroy_Bold',
                  ),
                ),
                const SizedBox(height: 15),

                if (isLoadingPaymentSettings)
                  Center(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 20),
                      child: CircularProgressIndicator(color: notifier.darklinercolor),
                    ),
                  )
                else if (paymentWallet == 0 && paymentCod == 0)
                  Center(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 20),
                      child: Text(
                        "No payment methods available".tr,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Medium',
                          fontSize: 14,
                        ),
                      ),
                    ),
                  )
                else ...[
                  // Cash Option (Top)
                  if (paymentCod == 1) ...[
                    GestureDetector(
                      onTap: () {
                        setState(() {
                          selectedPaymentMethod = 2;
                        });
                      },
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
                        decoration: BoxDecoration(
                          color: selectedPaymentMethod == 2 ? notifier.darklinercolor.withOpacity(0.1) : notifier.getBgColor,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: selectedPaymentMethod == 2 ? notifier.darklinercolor : notifier.bordecolor,
                            width: selectedPaymentMethod == 2 ? 2 : 1,
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.money, color: notifier.darklinercolor),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                "Cash".tr,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Medium',
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            if (selectedPaymentMethod == 2)
                              Icon(Icons.check_circle, color: notifier.darklinercolor),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],

                  // Wallet Option (Bottom)
                  if (paymentWallet == 1) ...[
                    GestureDetector(
                      onTap: () {
                        setState(() {
                          selectedPaymentMethod = 1;
                        });
                      },
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
                        decoration: BoxDecoration(
                          color: selectedPaymentMethod == 1 ? notifier.darklinercolor.withOpacity(0.1) : notifier.getBgColor,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: selectedPaymentMethod == 1 ? notifier.darklinercolor : notifier.bordecolor,
                            width: selectedPaymentMethod == 1 ? 2 : 1,
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.credit_card, color: notifier.darklinercolor),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                "Shifter Wallet (${widget.currency}${widget.walletBalance.toStringAsFixed(2)})".tr,
                                style: TextStyle(
                                  color: notifier.text,
                                  fontFamily: 'Gilroy_Medium',
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 10),
                            // Show "ADD MONEY" button if wallet balance is low
                            if (widget.walletBalance < widget.deliveryFees && selectedPaymentMethod == 1)
                              GestureDetector(
                                onTap: () {
                                  Get.to(() => const WalletPage());
                                },
                                child: Container(
                                  constraints: const BoxConstraints(minWidth: 80),
                                  child: Text(
                                    "ADD MONEY".tr,
                                    style: TextStyle(
                                      color: notifier.darklinercolor,
                                      fontFamily: 'Gilroy_Bold',
                                      fontSize: 12,
                                    ),
                                    textAlign: TextAlign.right,
                                  ),
                                ),
                              )
                            else if (selectedPaymentMethod == 1)
                              Icon(Icons.check_circle, color: notifier.darklinercolor),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                ],

                Text(
                  "By booking you agree to our new terms of service and privacy policy".tr,
                  style: TextStyle(
                    fontSize: 12,
                    color: greaycolor,
                    fontFamily: 'Gilroy_Medium',
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                Container(
                  width: double.infinity,
                  height: 50,
                  child: ElevatedButton(
                    onPressed: (isProcessing || (paymentWallet == 0 && paymentCod == 0) || selectedPaymentMethod == 0) ? null : () {
                      if (selectedPaymentMethod == 1 && paymentWallet == 1) {
                        if (widget.walletBalance >= widget.deliveryFees) {
                          setState(() { isProcessing = true; });
                          widget.onConfirmPayment(-2, "Wallet");
                          // Reset processing after 15 seconds in case of API failure timeout
                          Future.delayed(const Duration(seconds: 15), () {
                            if (mounted) setState(() { isProcessing = false; });
                          });
                        } else {
                          ApiWrapper.showToastMessage("Insufficient wallet balance. Please add money to your wallet.".tr);
                        }
                      } else if (selectedPaymentMethod == 2 && paymentCod == 1) {
                        setState(() { isProcessing = true; });
                        widget.onConfirmPayment(1, "Cash");
                        Future.delayed(const Duration(seconds: 15), () {
                          if (mounted) setState(() { isProcessing = false; });
                        });
                      } else {
                        ApiWrapper.showToastMessage("Please select a valid payment method.".tr);
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: ((paymentWallet == 0 && paymentCod == 0) || selectedPaymentMethod == 0 || (selectedPaymentMethod == 1 && widget.walletBalance < widget.deliveryFees))
                          ? Colors.grey
                          : notifier.darklinercolor,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: isProcessing
                        ? const SizedBox(
                            height: 24,
                            width: 24,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                          )
                        : Text(
                            ((paymentWallet == 0 && paymentCod == 0) || selectedPaymentMethod == 0)
                                ? "No Payment Method Available".tr
                                : (selectedPaymentMethod == 1 && widget.walletBalance < widget.deliveryFees)
                                    ? "Insufficient Balance".tr
                                    : "Confirm\n Amount ${widget.currency}${widget.deliveryFees.toStringAsFixed(2)}".tr,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 16,
                            ),
                          ),
                  ),
                ),
               // const SizedBox(height: 10),
                Center(
                  child: TextButton(
                    onPressed: widget.onViewBreakup,
                    child: Text(
                      "View Breakup".tr,
                      style: TextStyle(
                        color: notifier.darklinercolor,
                        fontFamily: 'Gilroy_Bold',
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
