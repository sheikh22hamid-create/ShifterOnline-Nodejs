import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_polyline_points/flutter_polyline_points.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import 'location_search_screen.dart';

class AddStopsScreen extends StatefulWidget {
  final Map<String, dynamic> pickup;
  final Map<String, dynamic> drop;
  final List<Map<String, dynamic>> stops;
  final int bookingType;
  final Function(Map<String, dynamic> pickup, Map<String, dynamic> drop, List<Map<String, dynamic>> stops)? onConfirm;

  const AddStopsScreen({
    super.key,
    required this.pickup,
    required this.drop,
    this.stops = const [],
    this.bookingType = 1,
    this.onConfirm,
  });

  @override
  State<AddStopsScreen> createState() => _AddStopsScreenState();
}

class _AddStopsScreenState extends State<AddStopsScreen> {
  final GetStorage _storage = GetStorage();
  final PolylinePoints _polylinePoints = PolylinePoints();
  GoogleMapController? _mapController;

  late Map<String, dynamic> _pickupData;
  late Map<String, dynamic> _dropData;
  late List<Map<String, dynamic>> _stops;
  // Admin-configured cap (Settings > max_extra_stops), same cached value
  // home.dart's own add-stop flow already enforces - this screen is a
  // separate map-based stop picker that was missing the same guard.
  late final int _maxExtraStops = int.tryParse(_storage.read("max_extra_stops")?.toString() ?? "2") ?? 2;

  List<LatLng> _roadRoute = [];
  bool _loadingRoute = true;
  Set<Marker> _markers = {};

  @override
  void initState() {
    super.initState();
    _pickupData = Map<String, dynamic>.from(widget.pickup);
    _dropData = Map<String, dynamic>.from(widget.drop);
    _stops = widget.stops.map((s) => Map<String, dynamic>.from(s)).toList();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadRoadRoute();
    });
  }

  double _number(dynamic value) => double.tryParse(value?.toString() ?? '') ?? 0;

  LatLng get _pickup => LatLng(_number(_pickupData['lat_map']), _number(_pickupData['long_map']));
  LatLng get _drop => LatLng(_number(_dropData['lat_map']), _number(_dropData['long_map']));

  String _contactLine(Map<String, dynamic> data, String fallbackRole) {
    final name = (data['c_name'] ?? '').toString().trim();
    final mobile = (data['c_number'] ?? '').toString().trim();
    if (name.isNotEmpty && mobile.isNotEmpty) {
      return "$name · $mobile";
    } else if (name.isNotEmpty) {
      return name;
    } else if (mobile.isNotEmpty) {
      return mobile;
    }
    return fallbackRole;
  }

  String _addressLine(Map<String, dynamic> data) {
    final address = (data['address'] ?? data['c_ddress'] ?? '').toString().trim();
    if (address.isNotEmpty) return address;
    final hno = (data['hno'] ?? '').toString().trim();
    return hno.isNotEmpty ? hno : "Selected Location";
  }

  Future<void> _loadRoadRoute() async {
    if (!mounted) return;
    setState(() => _loadingRoute = true);

    final points = <LatLng>[];
    try {
      final waypoints = _stops
          .map((stop) => '${stop['lat_map']},${stop['long_map']}')
          .where((w) => w != '0.0,0.0' && w != ',')
          .join('|');

      final url = Uri.parse(
        'https://maps.googleapis.com/maps/api/directions/json?'
        'origin=${_pickup.latitude},${_pickup.longitude}&'
        'destination=${_drop.latitude},${_drop.longitude}&'
        '${waypoints.isEmpty ? '' : 'waypoints=${Uri.encodeComponent(waypoints)}&'}'
        'mode=driving&key=${Config.googleApikey}',
      );

      final response = await http.get(url).timeout(const Duration(seconds: 12));
      final data = jsonDecode(response.body);
      if (data is Map && data['status'] == 'OK' && data['routes'] is List && (data['routes'] as List).isNotEmpty) {
        final encoded = data['routes'][0]['overview_polyline']?['points'];
        if (encoded is String && encoded.isNotEmpty) {
          points.addAll(_polylinePoints.decodePolyline(encoded).map((p) => LatLng(p.latitude, p.longitude)));
        }
      }
    } catch (e) {
      debugPrint("Directions error: $e");
    }

    if (points.isEmpty) {
      // Fallback straight line points
      points.add(_pickup);
      for (final s in _stops) {
        points.add(LatLng(_number(s['lat_map']), _number(s['long_map'])));
      }
      points.add(_drop);
    }

    await _buildCustomMarkers();

    if (!mounted) return;
    setState(() {
      _roadRoute = points;
      _loadingRoute = false;
    });

    if (points.length > 1) {
      _fitRoute();
    }
  }

  Future<void> _buildCustomMarkers() async {
    final newMarkers = <Marker>{};

    // 1. Pickup Marker (Green Pin)
    final pickupIcon = await _createNumberedPin(
      icon: Icons.arrow_upward_rounded,
      color: const Color(0xff10B981),
      isArrow: true,
    );
    newMarkers.add(
      Marker(
        markerId: const MarkerId('pickup'),
        position: _pickup,
        icon: pickupIcon,
        infoWindow: InfoWindow(title: 'Pickup', snippet: _addressLine(_pickupData)),
      ),
    );

    // 2. Intermediate Stops Markers (Numbered Pin)
    for (int i = 0; i < _stops.length; i++) {
      final stop = _stops[i];
      final stopLatLng = LatLng(_number(stop['lat_map']), _number(stop['long_map']));
      final stopIcon = await _createNumberedPin(
        label: "${i + 1}",
        color: linercolor,
        isArrow: false,
      );
      newMarkers.add(
        Marker(
          markerId: MarkerId('stop_$i'),
          position: stopLatLng,
          icon: stopIcon,
          infoWindow: InfoWindow(title: 'Stop ${i + 1}', snippet: _addressLine(stop)),
        ),
      );
    }

    // 3. Drop Marker (Red Pin)
    final dropIcon = await _createNumberedPin(
      icon: Icons.arrow_downward_rounded,
      color: const Color(0xffEF4444),
      isArrow: true,
    );
    newMarkers.add(
      Marker(
        markerId: const MarkerId('drop'),
        position: _drop,
        icon: dropIcon,
        infoWindow: InfoWindow(title: 'Drop', snippet: _addressLine(_dropData)),
      ),
    );

    _markers = newMarkers;
  }

  Future<BitmapDescriptor> _createNumberedPin({
    String? label,
    IconData? icon,
    required Color color,
    bool isArrow = false,
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
            fontSize: 34,
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

  void _fitRoute() {
    if (_mapController == null) return;
    final allPoints = <LatLng>[
      _pickup,
      ..._stops.map((s) => LatLng(_number(s['lat_map']), _number(s['long_map']))),
      _drop,
    ];

    var minLat = allPoints.first.latitude, maxLat = allPoints.first.latitude;
    var minLng = allPoints.first.longitude, maxLng = allPoints.first.longitude;
    for (final p in allPoints) {
      minLat = math.min(minLat, p.latitude);
      maxLat = math.max(maxLat, p.latitude);
      minLng = math.min(minLng, p.longitude);
      maxLng = math.max(maxLng, p.longitude);
    }

    _mapController!.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(minLat, minLng),
          northeast: LatLng(maxLat, maxLng),
        ),
        60,
      ),
    );
  }

  // Add new stop dynamically
  Future<void> _addNewStop() async {
    if (_stops.length >= _maxExtraStops) {
      ApiWrapper.showToastMessage("Maximum $_maxExtraStops extra stops allowed.");
      return;
    }
    final result = await Get.to<Map<String, dynamic>>(
      () => LocationSearchScreen(
        locationType: "Stop",
        stopIndex: _stops.length,
        pickupData: _pickupData,
      ),
    );

    if (result != null && mounted) {
      setState(() {
        _stops.add(Map<String, dynamic>.from(result));
      });
      _loadRoadRoute();
    }
  }

  // Edit an existing stop
  Future<void> _editStop(int index) async {
    final result = await Get.to<Map<String, dynamic>>(
      () => LocationSearchScreen(
        locationType: "Stop",
        stopIndex: index,
        initialData: _stops[index],
        pickupData: _pickupData,
      ),
    );

    if (result != null && mounted) {
      setState(() {
        _stops[index] = Map<String, dynamic>.from(result);
      });
      _loadRoadRoute();
    }
  }

  // Edit pickup
  Future<void> _editPickup() async {
    final result = await Get.to<Map<String, dynamic>>(
      () => LocationSearchScreen(
        locationType: "Pickup",
        initialData: _pickupData,
      ),
    );

    if (result != null && mounted) {
      setState(() {
        _pickupData = Map<String, dynamic>.from(result);
      });
      _storage.write("PickupAddress", [_pickupData]);
      _loadRoadRoute();
    }
  }

  // Edit drop
  Future<void> _editDrop() async {
    final result = await Get.to<Map<String, dynamic>>(
      () => LocationSearchScreen(
        locationType: "Drop",
        initialData: _dropData,
        pickupData: _pickupData,
      ),
    );

    if (result != null && mounted) {
      setState(() {
        _dropData = Map<String, dynamic>.from(result);
      });
      _storage.write("DropeAddress", [_dropData]);
      _loadRoadRoute();
    }
  }

  // Remove stop
  void _removeStop(int index) {
    setState(() {
      _stops.removeAt(index);
    });
    _loadRoadRoute();
  }

  void _onConfirm() {
    _storage.write("PickupAddress", [_pickupData]);
    _storage.write("DropeAddress", [_dropData]);

    final resultData = {
      'pickup': _pickupData,
      'drop': _dropData,
      'stops': _stops,
    };

    if (widget.onConfirm != null) {
      widget.onConfirm!(_pickupData, _dropData, _stops);
    }

    Get.back(result: resultData);
  }

  @override
  Widget build(BuildContext context) {
    final notifier = Provider.of<ColorNotifier>(context, listen: true);
    final themeColor = notifier.darklinercolor;

    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      appBar: AppBar(
        backgroundColor: notifier.lightBgColor,
        foregroundColor: notifier.text,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => Get.back(),
        ),
        title: Text(
          "Add Stops",
          style: TextStyle(
            fontFamily: 'Gilroy_Bold',
            fontSize: 19,
            color: notifier.text,
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            // ── TOP CARD: LIST OF STOPS & ADD STOP BUTTON ───────────────────
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: notifier.getBgColor,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.04),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // 1. Pickup Item
                  _buildStopRow(
                    indexBadge: null,
                    isPickup: true,
                    isDrop: false,
                    title: _contactLine(_pickupData, "Sender's Details"),
                    subtitle: _addressLine(_pickupData),
                    onTap: _editPickup,
                    onDelete: null,
                    canDrag: true,
                  ),

                  // 2. Intermediate Dynamic Stops (Reorderable)
                  ...List.generate(_stops.length, (index) {
                    final stop = _stops[index];
                    return _buildStopRow(
                      indexBadge: "${index + 1}",
                      isPickup: false,
                      isDrop: false,
                      title: _contactLine(stop, "Stop ${index + 1} Contact"),
                      subtitle: _addressLine(stop),
                      onTap: () => _editStop(index),
                      onDelete: () => _removeStop(index),
                      canDrag: true,
                    );
                  }),

                  // 3. Drop Item
                  _buildStopRow(
                    indexBadge: null,
                    isPickup: false,
                    isDrop: true,
                    title: _contactLine(_dropData, "Receiver's Details"),
                    subtitle: _addressLine(_dropData),
                    onTap: _editDrop,
                    onDelete: null,
                    canDrag: true,
                  ),

                  const Divider(height: 1, thickness: 0.8),

                  // 4. "+ Add Stop" Button
                  InkWell(
                    onTap: _addNewStop,
                    borderRadius: const BorderRadius.vertical(bottom: Radius.circular(18)),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.add_circle, color: linercolor, size: 20),
                          const SizedBox(width: 8),
                          Text(
                            "Add Stop",
                            style: TextStyle(
                              fontFamily: 'Gilroy_Bold',
                              fontSize: 14,
                              color: linercolor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // ── MAP VIEW ────────────────────────────────────────────────────
            Expanded(
              child: Container(
                margin: const EdgeInsets.fromLTRB(14, 6, 14, 10),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: notifier.bordecolor.withOpacity(0.6)),
                ),
                clipBehavior: Clip.antiAlias,
                child: Stack(
                  children: [
                    GoogleMap(
                      initialCameraPosition: CameraPosition(
                        target: _pickup,
                        zoom: 12,
                      ),
                      markers: _markers,
                      polylines: {
                        Polyline(
                          polylineId: const PolylineId('stops_route'),
                          points: _roadRoute,
                          color: linercolor,
                          width: 5,
                        ),
                      },
                      zoomControlsEnabled: false,
                      myLocationButtonEnabled: false,
                      onMapCreated: (controller) {
                        _mapController = controller;
                        if (_roadRoute.length > 1) {
                          _fitRoute();
                        }
                      },
                    ),

                    if (_loadingRoute)
                      Positioned(
                        top: 12,
                        right: 12,
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: notifier.getBgColor.withOpacity(0.9),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),

            // ── BOTTOM BUTTON: SELECT VEHICLE ───────────────────────────────
            Container(
              padding: EdgeInsets.fromLTRB(16, 8, 16, MediaQuery.of(context).padding.bottom + 8),
              decoration: BoxDecoration(
                color: notifier.getBgColor,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.05),
                    blurRadius: 10,
                    offset: const Offset(0, -3),
                  ),
                ],
              ),
              child: SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _onConfirm,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: linercolor,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    elevation: 0,
                  ),
                  child: const Text(
                    "Select Vehicle",
                    style: TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 15,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStopRow({
    String? indexBadge,
    required bool isPickup,
    required bool isDrop,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    VoidCallback? onDelete,
    bool canDrag = false,
  }) {
    final notifier = Provider.of<ColorNotifier>(context, listen: false);

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            // Left Indicator Icon
            if (isPickup)
              Container(
                width: 28,
                height: 28,
                decoration: const BoxDecoration(
                  color: Color(0xff10B981),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.arrow_upward_rounded, color: Colors.white, size: 16),
              )
            else if (isDrop)
              Container(
                width: 28,
                height: 28,
                decoration: const BoxDecoration(
                  color: Color(0xffEF4444),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.arrow_downward_rounded, color: Colors.white, size: 16),
              )
            else
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: linercolor,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    indexBadge ?? "1",
                    style: const TextStyle(
                      color: Colors.white,
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 13,
                    ),
                  ),
                ),
              ),

            const SizedBox(width: 12),

            // Middle: Name/Mobile & Address
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
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 13.5,
                      color: notifier.text,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: 'Gilroy_Medium',
                      fontSize: 11.5,
                      color: greaycolor,
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(width: 8),

            // Right side: Drag handle and Delete button
            if (canDrag)
              Icon(Icons.drag_handle_rounded, color: notifier.text.withOpacity(0.5), size: 20),

            if (onDelete != null) ...[
              const SizedBox(width: 8),
              InkWell(
                onTap: onDelete,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.all(2.0),
                  child: Icon(Icons.cancel_rounded, color: const Color(0xff64748B), size: 20),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
