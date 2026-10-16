import 'dart:math' as math;
import 'package:flutter/material.dart';

/// The vehicle families the app books. Anything unknown draws as the mini truck (4 wheeler).
enum BookedVehicleKind { bike, eLoader, threeWheeler, fourWheeler }

BookedVehicleKind bookedVehicleKindFor(String? vehicleName) {
  final name = (vehicleName ?? '').toLowerCase().replaceAll('-', ' ').replaceAll('_', ' ').trim();
  bool has(List<String> words) => words.any(name.contains);

  if (has(['bike', '2 wheeler', 'two wheeler', 'motorcycle', 'scooter'])) return BookedVehicleKind.bike;
  if (has(['e loader', 'eloader', 'e rickshaw', 'erickshaw', 'electric'])) return BookedVehicleKind.eLoader;
  if (has(['3 wheeler', 'three wheeler', '3wheeler', 'tempo'])) return BookedVehicleKind.threeWheeler;
  return BookedVehicleKind.fourWheeler;
}

/// Looping "your vehicle is on its way" animation that draws the vehicle the customer actually booked:
/// spinning wheels, a gently bouncing body, a moving road and speed lines. Drawn with vector paths so it needs no
/// asset and always matches the booked vehicle (Bike, E-Loader, 3 Wheeler or 4 Wheeler).
class VehicleBookingAnimation extends StatefulWidget {
  const VehicleBookingAnimation({
    super.key,
    required this.vehicleName,
    this.height = 150,
    this.showLabel = true,
    this.backgroundColor = Colors.white,
  });

  final String vehicleName;
  final double height;
  final bool showLabel;
  final Color backgroundColor;

  @override
  State<VehicleBookingAnimation> createState() => _VehicleBookingAnimationState();
}

class _VehicleBookingAnimationState extends State<VehicleBookingAnimation> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    // One loop drives everything; every phase below is a whole multiple of it, so the loop never "jumps".
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final kind = bookedVehicleKindFor(widget.vehicleName);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          height: widget.height,
          width: double.infinity,
          decoration: BoxDecoration(
            color: widget.backgroundColor,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(color: Colors.black.withOpacity(0.12), blurRadius: 18, offset: const Offset(0, 8)),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: RepaintBoundary(
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, _) => CustomPaint(
                  painter: _VehiclePainter(kind: kind, t: _controller.value),
                  size: Size.infinite,
                ),
              ),
            ),
          ),
        ),
        if (widget.showLabel) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white.withOpacity(0.45)),
            ),
            child: Text(
              widget.vehicleName.trim().isEmpty ? 'Your vehicle' : widget.vehicleName.trim(),
              style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 14, color: Colors.white),
            ),
          ),
        ],
      ],
    );
  }
}

class _VehiclePainter extends CustomPainter {
  _VehiclePainter({required this.kind, required this.t});

  final BookedVehicleKind kind;
  final double t; // 0..1, loops

  // Drawing space: 320 x 160, ground line at y = 128. Vehicles face right.
  static const double _w = 320;
  static const double _h = 160;
  static const double _ground = 128;

  static const Color _ink = Color(0xFF1F2937);
  static const Color _orange = Color(0xFFFA4500);
  static const Color _glass = Color(0xFFBFE3F5);

  @override
  void paint(Canvas canvas, Size size) {
    final scale = math.min(size.width / _w, size.height / _h);
    canvas.save();
    canvas.translate((size.width - _w * scale) / 2, (size.height - _h * scale) / 2);
    canvas.scale(scale);

    _drawSky(canvas);
    _drawRoad(canvas);
    _drawSpeedLines(canvas);

    // Suspension bounce (4 per loop) and a tiny forward-back rock so it feels like it is driving.
    final bob = math.sin(t * 2 * math.pi * 4) * 1.6;
    final rock = math.sin(t * 2 * math.pi * 2) * 0.012;
    canvas.save();
    canvas.translate(168, _ground + bob);
    canvas.rotate(rock);
    switch (kind) {
      case BookedVehicleKind.bike:
        _drawBike(canvas);
      case BookedVehicleKind.eLoader:
        _drawELoader(canvas);
      case BookedVehicleKind.threeWheeler:
        _drawThreeWheeler(canvas);
      case BookedVehicleKind.fourWheeler:
        _drawFourWheeler(canvas);
    }
    canvas.restore();
    canvas.restore();
  }

  // ---------------------------------------------------------------- scenery

  void _drawSky(Canvas canvas) {
    final paint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFFFFF3EA), Color(0xFFFFFFFF)],
      ).createShader(const Rect.fromLTWH(0, 0, _w, _h));
    canvas.drawRect(const Rect.fromLTWH(0, 0, _w, _h), paint);

    // Soft clouds drifting left (slower than the road = parallax).
    final cloud = Paint()..color = const Color(0xFFFFE4D2);
    for (var i = 0; i < 3; i++) {
      final x = ((i * 130 - t * 130) % 390) - 40;
      final y = 26.0 + (i % 2) * 20;
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, y, 52, 12), const Radius.circular(8)), cloud);
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x + 12, y - 8, 28, 12), const Radius.circular(8)), cloud);
    }
  }

  void _drawRoad(Canvas canvas) {
    canvas.drawRect(const Rect.fromLTWH(0, _ground, _w, _h - _ground), Paint()..color = const Color(0xFF374151));
    canvas.drawRect(const Rect.fromLTWH(0, _ground, _w, 3), Paint()..color = const Color(0xFF9CA3AF));
    // Dashed centre line scrolling left; the dash period is 40 and t covers exactly 2 periods per loop.
    final dash = Paint()..color = Colors.white.withOpacity(0.85);
    final offset = (t * 80) % 40;
    for (var x = -40.0; x < _w + 40; x += 40) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromLTWH(x - offset, _ground + 17, 22, 3.5), const Radius.circular(2)),
        dash,
      );
    }
  }

  void _drawSpeedLines(Canvas canvas) {
    final line = Paint()
      ..color = _orange.withOpacity(0.35)
      ..strokeWidth = 2.4
      ..strokeCap = StrokeCap.round;
    for (var i = 0; i < 4; i++) {
      final y = _ground - 18 - i * 17.0;
      final phase = (t * 3 + i * 0.27) % 1; // 3 sweeps per loop
      final x = 92 - phase * 70;
      final len = 14 + (i % 2) * 12;
      canvas.drawLine(Offset(x, y), Offset(x - len, y), line);
    }
  }

  // ---------------------------------------------------------------- parts

  /// Wheel centred at [c]; spokes turn 3 full circles per loop.
  void _wheel(Canvas canvas, Offset c, double r) {
    canvas.drawCircle(c, r, Paint()..color = _ink);
    canvas.drawCircle(c, r * 0.62, Paint()..color = const Color(0xFFE5E7EB));
    final spoke = Paint()
      ..color = const Color(0xFF6B7280)
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round;
    final angle = t * 2 * math.pi * 3;
    for (var i = 0; i < 5; i++) {
      final a = angle + i * 2 * math.pi / 5;
      canvas.drawLine(c, c + Offset(math.cos(a), math.sin(a)) * (r * 0.6), spoke);
    }
    canvas.drawCircle(c, r * 0.18, Paint()..color = _ink);
  }

  void _parcel(Canvas canvas, Rect rect, [Color color = const Color(0xFFD99A5B)]) {
    canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(2.5)), Paint()..color = color);
    canvas.drawRect(
      Rect.fromLTWH(rect.center.dx - 1.6, rect.top, 3.2, rect.height),
      Paint()..color = Colors.white.withOpacity(0.55),
    );
  }

  void _shadow(Canvas canvas, double halfWidth) {
    canvas.drawOval(
      Rect.fromCenter(center: const Offset(0, 1), width: halfWidth * 2, height: 8),
      Paint()..color = Colors.black.withOpacity(0.18),
    );
  }

  void _headlight(Canvas canvas, Offset c) {
    canvas.drawCircle(c, 3.4, Paint()..color = const Color(0xFFFFE066));
    canvas.drawPath(
      Path()
        ..moveTo(c.dx + 2, c.dy - 3)
        ..lineTo(c.dx + 26, c.dy - 9)
        ..lineTo(c.dx + 26, c.dy + 9)
        ..lineTo(c.dx + 2, c.dy + 3)
        ..close(),
      Paint()..color = const Color(0xFFFFE066).withOpacity(0.22),
    );
  }

  // ---------------------------------------------------------------- vehicles (origin: ground, centre)

  void _drawBike(Canvas canvas) {
    _shadow(canvas, 56);
    final body = Paint()..color = _orange;
    final dark = Paint()..color = _ink;

    // delivery box on the rear carrier
    _parcel(canvas, const Rect.fromLTWH(-56, -66, 32, 26), const Color(0xFFFFB259));
    canvas.drawRect(const Rect.fromLTWH(-58, -40, 38, 4), dark);

    // swing arm + frame
    final frame = Paint()
      ..color = _ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(const Offset(-40, -18), const Offset(-6, -26), frame);
    canvas.drawLine(const Offset(-6, -26), const Offset(28, -50), frame);
    canvas.drawLine(const Offset(-6, -26), const Offset(30, -18), frame);
    // front fork + handlebar
    canvas.drawLine(const Offset(40, -18), const Offset(30, -52), frame);
    canvas.drawLine(const Offset(30, -52), const Offset(22, -62), frame..strokeWidth = 4);
    canvas.drawLine(const Offset(22, -62), const Offset(34, -62), frame);

    // tank + seat + engine
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-16, -50, 34, 14), const Radius.circular(7)), body);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-30, -46, 20, 7), const Radius.circular(3.5)), dark);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-6, -34, 22, 14), const Radius.circular(4)), Paint()..color = const Color(0xFF4B5563));
    // front mudguard
    canvas.drawArc(Rect.fromCircle(center: const Offset(40, -18), radius: 20), math.pi * 1.05, math.pi * 0.62, false,
        Paint()..color = _orange..style = PaintingStyle.stroke..strokeWidth = 3.5);
    _headlight(canvas, const Offset(36, -58));

    _wheel(canvas, const Offset(-40, -16), 16);
    _wheel(canvas, const Offset(40, -16), 16);
  }

  void _drawELoader(Canvas canvas) {
    _shadow(canvas, 84);
    const blue = Color(0xFF1D4ED8);

    // cargo bed (blue) with parcels
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-86, -52, 78, 30), const Radius.circular(4)), Paint()..color = blue);
    canvas.drawRect(const Rect.fromLTWH(-86, -52, 78, 5), Paint()..color = const Color(0xFF1E3A8A));
    _parcel(canvas, const Rect.fromLTWH(-80, -74, 26, 22));
    _parcel(canvas, const Rect.fromLTWH(-52, -68, 24, 16), const Color(0xFFE9B079));
    _parcel(canvas, const Rect.fromLTWH(-26, -74, 18, 22), const Color(0xFFD99A5B));

    // open-sided cabin: roof, pillars, seat
    final roof = Path()
      ..moveTo(-6, -84)
      ..lineTo(62, -84)
      ..quadraticBezierTo(70, -84, 68, -74)
      ..lineTo(66, -72)
      ..lineTo(-6, -72)
      ..close();
    canvas.drawPath(roof, Paint()..color = blue);
    final pillar = Paint()..color = _ink;
    canvas.drawRect(const Rect.fromLTWH(-4, -72, 4, 38), pillar);
    canvas.drawRect(const Rect.fromLTWH(60, -72, 4, 28), pillar);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(8, -50, 24, 16), const Radius.circular(4)), Paint()..color = const Color(0xFF111827));
    // windshield
    canvas.drawPath(
      Path()
        ..moveTo(60, -72)
        ..lineTo(66, -72)
        ..lineTo(74, -40)
        ..lineTo(64, -40)
        ..close(),
      Paint()..color = _glass.withOpacity(0.9),
    );
    // chassis + front panel
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-86, -26, 160, 8), const Radius.circular(3)), Paint()..color = _ink);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(52, -44, 26, 22), const Radius.circular(6)), Paint()..color = blue);
    // "EV" bolt badge
    final bolt = Path()
      ..moveTo(-44, -46)
      ..lineTo(-52, -37)
      ..lineTo(-46, -37)
      ..lineTo(-50, -29)
      ..lineTo(-40, -39)
      ..lineTo(-46, -39)
      ..close();
    canvas.drawPath(bolt, Paint()..color = const Color(0xFFFFE066));
    _headlight(canvas, const Offset(76, -34));

    _wheel(canvas, const Offset(-60, -14), 14);
    _wheel(canvas, const Offset(-32, -14), 14);
    _wheel(canvas, const Offset(58, -14), 14);
  }

  void _drawThreeWheeler(Canvas canvas) {
    _shadow(canvas, 82);
    const white = Color(0xFFF9FAFB);

    // open cargo bed with rails
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-84, -50, 82, 26), const Radius.circular(4)), Paint()..color = _orange);
    final rail = Paint()
      ..color = _ink
      ..strokeWidth = 2.4;
    for (var x = -82.0; x <= -4; x += 13) {
      canvas.drawLine(Offset(x, -50), Offset(x, -66), rail);
    }
    canvas.drawLine(const Offset(-82, -66), const Offset(-4, -66), rail);
    _parcel(canvas, const Rect.fromLTWH(-78, -76, 28, 26));
    _parcel(canvas, const Rect.fromLTWH(-46, -68, 24, 18), const Color(0xFFE9B079));

    // enclosed cab with hood
    final cab = Path()
      ..moveTo(0, -24)
      ..lineTo(0, -78)
      ..lineTo(34, -78)
      ..lineTo(50, -50)
      ..lineTo(76, -46)
      ..quadraticBezierTo(82, -44, 82, -36)
      ..lineTo(82, -24)
      ..close();
    canvas.drawPath(cab, Paint()..color = white);
    canvas.drawPath(cab, Paint()
      ..color = const Color(0xFFD1D5DB)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5);
    // window
    canvas.drawPath(
      Path()
        ..moveTo(6, -72)
        ..lineTo(32, -72)
        ..lineTo(45, -50)
        ..lineTo(6, -50)
        ..close(),
      Paint()..color = _glass,
    );
    canvas.drawRect(const Rect.fromLTWH(0, -36, 82, 4), Paint()..color = _orange);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-84, -26, 168, 7), const Radius.circular(3)), Paint()..color = _ink);
    _headlight(canvas, const Offset(80, -40));

    _wheel(canvas, const Offset(-52, -14), 15);
    _wheel(canvas, const Offset(-26, -14), 15);
    _wheel(canvas, const Offset(58, -14), 15);
  }

  void _drawFourWheeler(Canvas canvas) {
    _shadow(canvas, 92);
    const cabColor = Color(0xFFFFFFFF);

    // open cargo bed with side panel
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-94, -54, 100, 30), const Radius.circular(4)), Paint()..color = _orange);
    canvas.drawRect(const Rect.fromLTWH(-94, -54, 100, 5), Paint()..color = const Color(0xFFC2410C));
    _parcel(canvas, const Rect.fromLTWH(-88, -80, 30, 26));
    _parcel(canvas, const Rect.fromLTWH(-54, -72, 26, 18), const Color(0xFFE9B079));
    _parcel(canvas, const Rect.fromLTWH(-26, -80, 24, 26), const Color(0xFFD99A5B));

    // cab
    final cab = Path()
      ..moveTo(10, -24)
      ..lineTo(10, -76)
      ..lineTo(44, -76)
      ..lineTo(62, -50)
      ..lineTo(88, -46)
      ..quadraticBezierTo(94, -44, 94, -36)
      ..lineTo(94, -24)
      ..close();
    canvas.drawPath(cab, Paint()..color = cabColor);
    canvas.drawPath(cab, Paint()
      ..color = const Color(0xFFD1D5DB)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5);
    canvas.drawPath(
      Path()
        ..moveTo(16, -70)
        ..lineTo(42, -70)
        ..lineTo(56, -50)
        ..lineTo(16, -50)
        ..close(),
      Paint()..color = _glass,
    );
    canvas.drawRect(const Rect.fromLTWH(10, -36, 84, 4), Paint()..color = _orange);
    // bumper + chassis
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-94, -26, 192, 7), const Radius.circular(3)), Paint()..color = _ink);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(88, -30, 12, 6), const Radius.circular(2)), Paint()..color = const Color(0xFF6B7280));
    _headlight(canvas, const Offset(92, -40));

    _wheel(canvas, const Offset(-58, -14), 16);
    _wheel(canvas, const Offset(66, -14), 16);
  }

  @override
  bool shouldRepaint(covariant _VehiclePainter old) => old.t != t || old.kind != kind;
}
