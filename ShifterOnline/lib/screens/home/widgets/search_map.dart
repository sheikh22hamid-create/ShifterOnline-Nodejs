import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../theme/app_tokens.dart';

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

/// Map behind the "Finding your driver" sheet: pickup and drop pins and a curved route that draws in once.
/// Built once; later rebuilds of the parent with the same points change nothing on the map.
class SearchRouteMap extends StatefulWidget {
  const SearchRouteMap({super.key, required this.pickup, required this.drop, this.bottomPadding = 0});

  final LatLng? pickup;
  final LatLng? drop;

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
    if (old.pickup != widget.pickup || old.drop != widget.drop) {
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
    final p = widget.pickup, d = widget.drop;
    _arc = p != null && d != null ? arcBetween(p, d) : const [];
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
    final (pick, drop) = await routePinIcons();
    if (!mounted) return;
    setState(() {
      _pickupIcon = pick;
      _dropIcon = drop;
    });
  }

  Future<void> _fit() async {
    final c = _controller;
    final p = widget.pickup, d = widget.drop;
    if (c == null || _fitted || p == null) return;
    _fitted = true;
    if (d == null) {
      await c.animateCamera(CameraUpdate.newLatLngZoom(p, 15));
      return;
    }
    final pts = [p, d, ..._arc];
    var minLat = pts.first.latitude, maxLat = minLat, minLng = pts.first.longitude, maxLng = minLng;
    for (final q in pts) {
      minLat = math.min(minLat, q.latitude);
      maxLat = math.max(maxLat, q.latitude);
      minLng = math.min(minLng, q.longitude);
      maxLng = math.max(maxLng, q.longitude);
    }
    await c.animateCamera(CameraUpdate.newLatLngBounds(
        LatLngBounds(southwest: LatLng(minLat, minLng), northeast: LatLng(maxLat, maxLng)), 64));
    if (mounted) _startDraw();
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final pickup = widget.pickup;
    if (pickup == null) {
      // Order details not loaded yet: a calm placeholder instead of a jumping map.
      return ColoredBox(color: p.divider);
    }
    final markers = <Marker>{
      Marker(
        markerId: const MarkerId('pickup'),
        position: pickup,
        icon: _pickupIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
        anchor: const Offset(0.5, 0.92),
      ),
      if (widget.drop != null)
        Marker(
          markerId: const MarkerId('drop'),
          position: widget.drop!,
          icon: _dropIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
          anchor: const Offset(0.5, 0.92),
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
    return GoogleMap(
      initialCameraPosition: CameraPosition(target: pickup, zoom: 13),
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
  }
}

Future<(BitmapDescriptor, BitmapDescriptor)>? _pinCache;

/// Pickup (green ↑) and drop (red ↓) pins, drawn once and shared by the searching map and the
/// tracking map so both screens look the same.
Future<(BitmapDescriptor, BitmapDescriptor)> routePinIcons() => _pinCache ??= () async {
      final p = AppPalette.light;
      final pick = await _pinBitmap(p.success, Icons.arrow_upward_rounded);
      final drop = await _pinBitmap(p.danger, Icons.arrow_downward_rounded);
      return (pick, drop);
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
