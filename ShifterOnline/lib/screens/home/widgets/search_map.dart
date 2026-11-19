import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/map_style.dart';

/// Points on a gentle curve from [a] to [b] (quadratic Bézier, bowed to one side), like Porter's
/// "searching" route. Drawn on the client, so it needs no Directions API call.
List<LatLng> arcBetween(LatLng a, LatLng b, {int segments = 48, double bend = 0.22}) {
  if (a == b) return [a];
  final dx = b.longitude - a.longitude;
  final dy = b.latitude - a.latitude;
  // Control point: the midpoint pushed sideways (perpendicular) by [bend] × the distance.
  final cx = (a.longitude + b.longitude) / 2 - dy * bend;
  final cy = (a.latitude + b.latitude) / 2 + dx * bend;
  return [
    for (var i = 0; i <= segments; i++)
      () {
        final t = i / segments;
        final u = 1 - t;
        if (i == 0) return a;
        if (i == segments) return b;
        return LatLng(
          u * u * a.latitude + 2 * u * t * cy + t * t * b.latitude,
          u * u * a.longitude + 2 * u * t * cx + t * t * b.longitude,
        );
      }(),
  ];
}

/// One curve per leg: pickup → each stop → drop (consecutive legs share their joining point once).
List<LatLng> routeArc(LatLng a, List<LatLng> stops, LatLng b) {
  final pts = [a, ...stops, b];
  final out = <LatLng>[];
  for (var i = 0; i + 1 < pts.length; i++) {
    final leg = arcBetween(pts[i], pts[i + 1]);
    out.addAll(out.isEmpty ? leg : leg.skip(1));
  }
  return out;
}

/// Stop points from the order's `stops` list ([{lat, lng, sequence…}]); entries without numbers are skipped.
List<LatLng> parseStopPoints(Object? raw) {
  if (raw is! List) return const [];
  final out = <LatLng>[];
  for (final s in raw) {
    if (s is! Map) continue;
    final lat = double.tryParse('${s['lat'] ?? ''}'), lng = double.tryParse('${s['lng'] ?? ''}');
    if (lat != null && lng != null) out.add(LatLng(lat, lng));
  }
  return out;
}

/// Pin tip as a fraction of the pin bitmap's height (tip drawn at h - 4 of 92 px).
const double kRoutePinAnchorY = 88 / 92;

/// Map behind the "Finding your driver" sheet: pickup and drop pins and a curved route that draws in once.
/// Built once; later rebuilds of the parent with the same points change nothing on the map.
class SearchRouteMap extends StatefulWidget {
  const SearchRouteMap(
      {super.key, required this.pickup, required this.drop, this.stops = const [], this.bottomPadding = 0});

  final LatLng? pickup;
  final LatLng? drop;

  /// Stops between pickup and drop, in order (numbered pins; the route passes through them).
  final List<LatLng> stops;

  /// Height of the sheet covering the bottom of the map, so the route is framed above it.
  final double bottomPadding;

  @override
  State<SearchRouteMap> createState() => _SearchRouteMapState();
}

class _SearchRouteMapState extends State<SearchRouteMap> with SingleTickerProviderStateMixin {
  GoogleMapController? _controller;
  BitmapDescriptor? _pickupIcon;
  BitmapDescriptor? _dropIcon;
  List<LatLng> _arc = const [];
  late final AnimationController _draw =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..addListener(_onDraw);
  int _shown = 0;
  bool _fitted = false;

  @override
  void initState() {
    super.initState();
    _rebuildArc();
    _loadIcons();
  }

  @override
  void didUpdateWidget(SearchRouteMap old) {
    super.didUpdateWidget(old);
    if (old.pickup != widget.pickup || old.drop != widget.drop || !listEquals(old.stops, widget.stops)) {
      _fitted = false;
      _rebuildArc();
      _fit();
    }
  }

  @override
  void dispose() {
    _draw.dispose();
    super.dispose();
  }

  void _rebuildArc() {
    _draw.stop();
    final p = widget.pickup, d = widget.drop;
    _arc = p != null && d != null ? routeArc(p, widget.stops, d) : const [];
    _shown = 0;
  }

  void _onDraw() {
    final n = (_draw.value * _arc.length).ceil().clamp(0, _arc.length);
    // Only push a new polyline to the map when it actually grew (keeps platform calls few).
    if (n != _shown && mounted) setState(() => _shown = n);
  }

  void _startDraw() {
    if (_arc.isEmpty) return;
    final still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (still) {
      setState(() => _shown = _arc.length);
    } else {
      _draw.forward(from: 0);
    }
  }

  Future<void> _loadIcons() async {
    final (BitmapDescriptor, BitmapDescriptor) pins;
    try {
      pins = await routePinIcons();
    } catch (_) {
      return; // default markers stay; the next screen retries
    }
    final (pick, drop) = pins;
    if (!mounted) return;
    setState(() {
      _pickupIcon = pick;
      _dropIcon = drop;
    });
  }

  Future<void> _fit({bool draw = true}) async {
    final c = _controller;
    final p = widget.pickup, d = widget.drop;
    if (c == null || _fitted || p == null) return;
    _fitted = true;
    try {
      await _moveCamera(c, p, d);
    } catch (_) {
      // e.g. "map size can't be 0" before layout, or a controller from a map that left the tree.
      _fitted = false;
    } finally {
      // The route draws even if the camera could not move.
      if (mounted && draw) _startDraw();
    }
  }

  Future<void> _moveCamera(GoogleMapController c, LatLng p, LatLng? d) async {
    // Pickup and drop (almost) at the same spot: zoom to a sensible level instead of an empty box.
    if (d == null || (widget.stops.isEmpty && (p.latitude - d.latitude).abs() < 0.002 && (p.longitude - d.longitude).abs() < 0.002)) {
      await c.animateCamera(CameraUpdate.newLatLngZoom(p, 15));
      return;
    }
    final pts = [p, d, ...widget.stops, ..._arc];
    var minLat = pts.first.latitude, maxLat = minLat, minLng = pts.first.longitude, maxLng = minLng;
    for (final q in pts) {
      minLat = math.min(minLat, q.latitude);
      maxLat = math.max(maxLat, q.latitude);
      minLng = math.min(minLng, q.longitude);
      maxLng = math.max(maxLng, q.longitude);
    }
    await c.animateCamera(CameraUpdate.newLatLngBounds(
        LatLngBounds(southwest: LatLng(minLat, minLng), northeast: LatLng(maxLat, maxLng)), 64));
  }

  /// Recenter button: frame pickup and drop again after the user panned away.
  void _recenter() {
    _fitted = false;
    _fit(draw: false);
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final pickup = widget.pickup;
    if (pickup == null) {
      // Order details not loaded yet: a calm placeholder instead of a jumping map.
      _controller = null;
      _fitted = false;
      return ColoredBox(color: p.divider);
    }
    final markers = <Marker>{
      Marker(
        markerId: const MarkerId('pickup'),
        position: pickup,
        icon: _pickupIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
        anchor: const Offset(0.5, kRoutePinAnchorY),
      ),
      if (widget.drop != null)
        Marker(
          markerId: const MarkerId('drop'),
          position: widget.drop!,
          icon: _dropIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
          anchor: const Offset(0.5, kRoutePinAnchorY),
        ),
      for (var i = 0; i < widget.stops.length; i++)
        Marker(
          markerId: MarkerId('stop_$i'),
          position: widget.stops[i],
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
          infoWindow: InfoWindow(title: '${'Stop'.tr} ${i + 1}'),
        ),
    };
    final polylines = <Polyline>{
      if (_shown > 1)
        Polyline(
          polylineId: const PolylineId('route'),
          points: _arc.sublist(0, _shown),
          color: p.brand,
          width: 4,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
        ),
    };
    final map = GoogleMap(
      initialCameraPosition: CameraPosition(target: pickup, zoom: 13),
      style: currentMapStyle(),
      markers: markers,
      polylines: polylines,
      padding: EdgeInsets.only(top: 24, bottom: widget.bottomPadding),
      myLocationButtonEnabled: false,
      zoomControlsEnabled: false,
      rotateGesturesEnabled: false,
      tiltGesturesEnabled: false,
      mapToolbarEnabled: false,
      compassEnabled: false,
      onMapCreated: (c) {
        _controller = c;
        _fit();
      },
    );
    return Stack(
      children: [
        Positioned.fill(child: map),
        Positioned(
          right: 14,
          bottom: widget.bottomPadding + 14,
          child: Material(
            color: p.surface,
            shape: const CircleBorder(),
            elevation: 3,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: _recenter,
              child: Tooltip(
                message: 'Recenter'.tr,
                child: SizedBox(width: 48, height: 48, child: Icon(Icons.my_location_rounded, color: p.ink, size: 22)),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

Future<(BitmapDescriptor, BitmapDescriptor)>? _pinCache;

/// Draws one pin; replaceable in tests.
@visibleForTesting
Future<BitmapDescriptor> Function(Color color, IconData icon) pinRenderer = _pinBitmap;

@visibleForTesting
void resetRoutePinCache() => _pinCache = null;

/// Pickup (green ↑) and drop (red ↓) pins, drawn once and shared by the searching map and the
/// tracking map so both screens look the same.
/// A failed render is not kept: the cache is cleared so the next call tries again.
Future<(BitmapDescriptor, BitmapDescriptor)> routePinIcons() => _pinCache ??= () async {
      try {
        final p = AppPalette.light;
        final pick = await pinRenderer(p.success, Icons.arrow_upward_rounded);
        final drop = await pinRenderer(p.danger, Icons.arrow_downward_rounded);
        return (pick, drop);
      } catch (_) {
        _pinCache = null;
        rethrow;
      }
    }();

/// Round pin with a white ring and an arrow, drawn once to a bitmap (pickup green ↑, drop red ↓).
Future<BitmapDescriptor> _pinBitmap(Color color, IconData icon) async {
  const w = 72.0, h = 92.0, r = 30.0;
  const centre = Offset(w / 2, r + 4);
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  final path = Path()
    ..addOval(Rect.fromCircle(center: centre, radius: r))
    ..moveTo(w / 2 - 14, centre.dy + r - 6)
    ..lineTo(w / 2, h - 4)
    ..lineTo(w / 2 + 14, centre.dy + r - 6)
    ..close();
  canvas.drawShadow(path, const Color(0x66000000), 4, false);
  canvas.drawPath(path, Paint()..color = color);
  canvas.drawCircle(centre, r - 3, Paint()
    ..color = const Color(0xFFFFFFFF)
    ..style = PaintingStyle.stroke
    ..strokeWidth = 3);
  final tp = TextPainter(
    text: TextSpan(
      text: String.fromCharCode(icon.codePoint),
      style: TextStyle(inherit: false, fontSize: 34, fontFamily: icon.fontFamily, package: icon.fontPackage, color: const Color(0xFFFFFFFF)),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  tp.paint(canvas, centre - Offset(tp.width / 2, tp.height / 2));
  final img = await recorder.endRecording().toImage(w.toInt(), h.toInt());
  final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
  return BitmapDescriptor.bytes(bytes!.buffer.asUint8List(), imagePixelRatio: 2);
}
