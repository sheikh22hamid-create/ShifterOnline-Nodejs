import 'package:flutter/material.dart';

import '../app_tokens.dart';

/// Orange truck driving along a dashed road (Home header, login). Still when the system asks for reduced motion.
class TruckRoad extends StatefulWidget {
  const TruckRoad({super.key});

  @override
  State<TruckRoad> createState() => TruckRoadState();
}

class TruckRoadState extends State<TruckRoad> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(seconds: 7));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduceMotion) {
      _controller.stop();
      _controller.value = 0.2;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return ExcludeSemantics(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => CustomPaint(
          painter: TruckRoadPainter(progress: _controller.value, brand: p.brand, road: p.brand.withValues(alpha: 0.35)),
        ),
      ),
    );
  }
}

class TruckRoadPainter extends CustomPainter {
  TruckRoadPainter({required this.progress, required this.brand, required this.road});

  final double progress;
  final Color brand;
  final Color road;

  @override
  void paint(Canvas canvas, Size size) {
    final roadPaint = Paint()..color = road;
    final roadY = size.height - 7;
    for (double x = 0; x < size.width; x += 18) {
      canvas.drawRect(Rect.fromLTWH(x, roadY, 10, 2), roadPaint);
    }

    const truckW = 62.0;
    final left = -truckW + (size.width + truckW) * progress;
    final top = size.height - 42;
    canvas.save();
    canvas.translate(left, top);
    canvas.drawRRect(RRect.fromLTRBR(2, 4, 38, 28, const Radius.circular(3)), Paint()..color = brand);
    canvas.drawRRect(RRect.fromLTRBR(8, 10, 22, 13, const Radius.circular(1.5)),
        Paint()..color = Colors.white.withValues(alpha: 0.85));
    canvas.drawPath(
        Path()
          ..moveTo(38, 12)
          ..lineTo(49, 12)
          ..lineTo(57, 21)
          ..lineTo(57, 28)
          ..lineTo(38, 28)
          ..close(),
        Paint()..color = const Color(0xFFFF8A5C));
    canvas.drawPath(
        Path()
          ..moveTo(41, 15)
          ..lineTo(48, 15)
          ..lineTo(53, 21)
          ..lineTo(41, 21)
          ..close(),
        Paint()..color = const Color(0xFFCFE4F5));
    canvas.drawRRect(RRect.fromLTRBR(0, 27, 60, 31, const Radius.circular(2)), Paint()..color = const Color(0xFF3A3E48));
    for (final cx in [14.0, 47.0]) {
      canvas.drawCircle(Offset(cx, 31), 5.5, Paint()..color = const Color(0xFF15171C));
      canvas.drawCircle(Offset(cx, 31), 2.2, Paint()..color = const Color(0xFFB8BDC6));
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(TruckRoadPainter old) =>
      old.progress != progress || old.brand != brand || old.road != road;
}
