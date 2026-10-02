import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../Api/Api_wrapper.dart';
import '../../Api/config.dart';
import '../../utils/colors.dart';
import '../home/home.dart' show getdata;

/// Route of a finished trip, drawn from the GPS trail the driver app reported
/// while driving: Driver start -> Pickup -> (final pickup / OTP point, when the
/// pickup was changed) -> Drop, with the total distance driven. Orders without
/// a recorded trail (older trips) fall back to a straight pickup -> drop line
/// and say so.
class OrderRouteMap extends StatefulWidget {
  final String orderId;

  /// true = card embedded in the order details page (non-interactive preview
  /// with a "Full screen" button); false = the full Route Map page.
  final bool embedded;
  const OrderRouteMap({super.key, required this.orderId, this.embedded = false});

  @override
  State<OrderRouteMap> createState() => _OrderRouteMapState();
}

class _OrderRouteMapState extends State<OrderRouteMap> {
  GoogleMapController? _controller;
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _route;

  static final List<PatternItem> _gapPattern = [PatternItem.dash(18), PatternItem.gap(12)];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final uid = (getdata.read("Uid") ?? "").toString();
      final res = await ApiWrapper.dataPostNode(Config.nodeOrderRoute, {"uid": uid, "order_id": widget.orderId});
      if (res is Map && res["Result"] == true && res["route"] is Map) {
        _route = Map<String, dynamic>.from(res["route"] as Map);
      } else {
        _error = (res is Map ? res["ResponseMsg"]?.toString() : null) ?? "Could not load the route.".tr;
      }
    } catch (e) {
      _error = "Could not load the route.".tr;
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  LatLng? _latLng(dynamic value) {
    if (value is! Map) return null;
    final lat = double.tryParse(value["lat"]?.toString() ?? "");
    final lng = double.tryParse(value["lng"]?.toString() ?? "");
    return (lat == null || lng == null) ? null : LatLng(lat, lng);
  }

  bool get _hasTrail => _route?["has_trail"] == true;

  List<Map<String, dynamic>> get _trail =>
      ((_route?["points"] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();

  Set<Polyline> _buildPolylines() {
    final lines = <Polyline>{};
    if (_route == null) return lines;

    if (_hasTrail) {
      // One polyline per (phase, offline-gap) run so the offline gaps are
      // dashed instead of a solid line the driver never actually drove.
      var run = <LatLng>[];
      var runPhase = 0;
      var index = 0;
      void flush({bool dashed = false}) {
        if (run.length >= 2) {
          // White casing under the coloured line makes the driven route pop.
          lines.add(Polyline(
            polylineId: PolylineId("casing_${index++}"),
            points: List<LatLng>.from(run),
            color: Colors.white,
            width: 10,
            zIndex: 1,
          ));
          lines.add(Polyline(
            polylineId: PolylineId("run_${index++}"),
            points: List<LatLng>.from(run),
            color: runPhase == 0 ? const Color(0xff2563EB) : const Color(0xffF97316),
            width: 6,
            zIndex: 2,
            patterns: dashed ? _gapPattern : <PatternItem>[],
          ));
        }
        run = <LatLng>[];
      }

      LatLng? previous;
      for (final p in _trail) {
        final point = LatLng(double.parse(p["lat"].toString()), double.parse(p["lng"].toString()));
        final phase = int.tryParse(p["phase"]?.toString() ?? "") ?? 0;
        if (p["gap"] == true && previous != null) {
          flush();
          lines.add(Polyline(
            polylineId: PolylineId("gap_${index++}"),
            points: [previous, point],
            color: Colors.grey,
            width: 3,
            patterns: _gapPattern,
          ));
          run = [point];
          runPhase = phase;
        } else if (phase != runPhase && run.isNotEmpty) {
          // Close the previous phase on this point so the line is continuous.
          run.add(point);
          flush();
          run = [point];
          runPhase = phase;
        } else {
          if (run.isEmpty) runPhase = phase;
          run.add(point);
        }
        previous = point;
      }
      flush();
    } else {
      final pickup = _latLng(_route!["final_pickup"]) ?? _latLng(_route!["pickup"]);
      final drop = _latLng(_route!["drop"]);
      if (pickup != null && drop != null) {
        lines.add(Polyline(
          polylineId: const PolylineId("planned"),
          points: [pickup, drop],
          color: Colors.grey,
          width: 4,
          patterns: _gapPattern,
        ));
      }
    }
    return lines;
  }

  Set<Marker> _buildMarkers() {
    final markers = <Marker>{};
    if (_route == null) return markers;

    void add(String id, dynamic where, double hue, String title) {
      final position = _latLng(where);
      if (position == null) return;
      markers.add(Marker(
        markerId: MarkerId(id),
        position: position,
        icon: BitmapDescriptor.defaultMarkerWithHue(hue),
        infoWindow: InfoWindow(title: title),
      ));
    }

    add("start", _route!["start"], BitmapDescriptor.hueAzure, "Driver start".tr);
    add("pickup", _route!["pickup"], BitmapDescriptor.hueGreen, "Pickup".tr);
    add("final_pickup", _route!["final_pickup"], BitmapDescriptor.hueOrange, "Final pickup".tr);
    add("otp", _route!["otp_point"], BitmapDescriptor.hueViolet, "OTP location".tr);
    final stops = ((_route!["stops"] as List?) ?? const []);
    for (var i = 0; i < stops.length; i++) {
      add("stop_$i", stops[i], BitmapDescriptor.hueYellow, "${"Stop".tr} ${i + 1}");
    }
    add("drop", _route!["drop"], BitmapDescriptor.hueRed, "Drop".tr);
    return markers;
  }

  List<LatLng> _allPoints() {
    final points = <LatLng>[];
    for (final marker in _buildMarkers()) {
      points.add(marker.position);
    }
    for (final line in _buildPolylines()) {
      points.addAll(line.points);
    }
    return points;
  }

  Future<void> _fitToRoute() async {
    final controller = _controller;
    final points = _allPoints();
    if (controller == null || points.isEmpty) return;
    var minLat = points.first.latitude, maxLat = points.first.latitude;
    var minLng = points.first.longitude, maxLng = points.first.longitude;
    for (final p in points) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLng) minLng = p.longitude;
      if (p.longitude > maxLng) maxLng = p.longitude;
    }
    if ((maxLat - minLat).abs() < 0.0002 && (maxLng - minLng).abs() < 0.0002) {
      await controller.animateCamera(CameraUpdate.newLatLngZoom(points.first, 16));
      return;
    }
    await controller.animateCamera(CameraUpdate.newLatLngBounds(
      LatLngBounds(southwest: LatLng(minLat, minLng), northeast: LatLng(maxLat, maxLng)),
      64,
    ));
  }

  Widget _legendDot(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(fontSize: 11.5, color: greaycolor, fontFamily: "Gilroy_Medium")),
      ],
    );
  }

  Widget _legendLine(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 18, height: 4, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(fontSize: 11.5, color: greaycolor, fontFamily: "Gilroy_Medium")),
      ],
    );
  }

  Widget _summaryCard() {
    final distance = double.tryParse(_route?["distance_km"]?.toString() ?? "") ?? 0;
    return SafeArea(
      top: false,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(18, 14, 18, 16),
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          boxShadow: widget.embedded ? null : [BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 12, offset: const Offset(0, -3))],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.route_rounded, color: linercolor),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    "${_hasTrail ? "Total distance".tr : "Planned distance".tr}: ${distance.toStringAsFixed(2)} km",
                    style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 16),
                  ),
                ),
              ],
            ),
            if (!_hasTrail) ...[
              const SizedBox(height: 6),
              Text(
                "Route not recorded for this order".tr,
                style: TextStyle(fontSize: 12.5, color: greaycolor, fontFamily: "Gilroy_Medium"),
              ),
            ],
            const SizedBox(height: 8),
            Wrap(
              spacing: 14,
              runSpacing: 4,
              children: [
                if (_hasTrail) _legendLine(const Color(0xff2563EB), "Driver to Pickup".tr),
                if (_hasTrail) _legendLine(const Color(0xffF97316), "Pickup to Drop".tr),
                _legendDot(const Color(0xff00B0FF), "Driver start".tr),
                _legendDot(Colors.green, "Pickup".tr),
                if (_route?["final_pickup"] != null) _legendDot(Colors.orange, "Final pickup".tr),
                if (_route?["otp_point"] != null) _legendDot(const Color(0xff7B2FF7), "OTP location".tr),
                _legendDot(Colors.red, "Drop".tr),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _openFullScreen() => Get.to(() => OrderRouteMap(orderId: widget.orderId));

  Widget _embeddedCard(LatLng initial) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: greaycolor.withOpacity(0.25)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 10, 10),
            child: Row(
              children: [
                Icon(Icons.route_rounded, color: linercolor, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text("Route Map".tr, style: const TextStyle(fontFamily: "Gilroy_Bold", fontSize: 15)),
                ),
                if (!_loading && _error == null)
                  TextButton.icon(
                    onPressed: _openFullScreen,
                    icon: Icon(Icons.fullscreen_rounded, size: 18, color: linercolor),
                    label: Text("Full screen".tr, style: TextStyle(color: linercolor, fontFamily: "Gilroy_Bold", fontSize: 12)),
                  ),
              ],
            ),
          ),
          if (_loading)
            SizedBox(height: 220, child: Center(child: CircularProgressIndicator(color: linercolor)))
          else if (_error != null)
            Padding(
              padding: const EdgeInsets.all(18),
              child: Center(
                child: Column(
                  children: [
                    Text(_error!, textAlign: TextAlign.center),
                    const SizedBox(height: 8),
                    TextButton(onPressed: _load, child: Text("Retry".tr)),
                  ],
                ),
              ),
            )
          else ...[
            SizedBox(
              height: 240,
              width: double.infinity,
              child: GoogleMap(
                initialCameraPosition: CameraPosition(target: initial, zoom: 13),
                polylines: _buildPolylines(),
                markers: _buildMarkers(),
                myLocationButtonEnabled: false,
                zoomControlsEnabled: false,
                scrollGesturesEnabled: false,
                zoomGesturesEnabled: false,
                rotateGesturesEnabled: false,
                tiltGesturesEnabled: false,
                mapToolbarEnabled: false,
                onTap: (_) => _openFullScreen(),
                onMapCreated: (controller) {
                  _controller = controller;
                  Future<void>.delayed(const Duration(milliseconds: 350), _fitToRoute);
                },
              ),
            ),
            _summaryCard(),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final initial = _latLng(_route?["pickup"]) ?? _latLng(_route?["drop"]) ?? const LatLng(20.5937, 78.9629);
    if (widget.embedded) return _embeddedCard(initial);
    return Scaffold(
      appBar: AppBar(
        title: Text("Route Map".tr),
        backgroundColor: linercolor,
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: linercolor))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        ElevatedButton(onPressed: _load, child: Text("Retry".tr)),
                      ],
                    ),
                  ),
                )
              : Column(
                  children: [
                    Expanded(
                      child: GoogleMap(
                        initialCameraPosition: CameraPosition(target: initial, zoom: 13),
                        polylines: _buildPolylines(),
                        markers: _buildMarkers(),
                        myLocationButtonEnabled: false,
                        zoomControlsEnabled: false,
                        onMapCreated: (controller) {
                          _controller = controller;
                          Future<void>.delayed(const Duration(milliseconds: 350), _fitToRoute);
                        },
                      ),
                    ),
                    _summaryCard(),
                  ],
                ),
    );
  }
}
