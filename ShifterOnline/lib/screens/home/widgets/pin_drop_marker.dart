import 'package:flutter/material.dart';

/// Map-centre pin that drops in and settles once, with a shadow below. Static with reduced motion.
class PinDropMarker extends StatefulWidget {
  const PinDropMarker({super.key, required this.color, this.animate = true});

  final Color color;
  final bool animate;

  static const double width = 40;
  static const double height = 52;

  @override
  State<PinDropMarker> createState() => _PinDropMarkerState();
}

class _PinDropMarkerState extends State<PinDropMarker> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1000), value: 1);
  bool _started = false;

  static final _drop = TweenSequence<double>([
    TweenSequenceItem(tween: Tween<double>(begin: -26, end: 0).chain(CurveTween(curve: Curves.easeIn)), weight: 60),
    TweenSequenceItem(tween: Tween<double>(begin: 0, end: -6).chain(CurveTween(curve: Curves.easeOut)), weight: 15),
    TweenSequenceItem(tween: Tween<double>(begin: -6, end: 0).chain(CurveTween(curve: Curves.easeIn)), weight: 25),
  ]);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (!_started && widget.animate && !reduceMotion) {
      _started = true;
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: SizedBox(
        width: PinDropMarker.width,
        height: PinDropMarker.height + 10,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final t = _controller.value;
            final dy = _drop.transform(t);
            final shadowScale = 0.4 + 0.6 * (1 - dy.abs() / 26);
            return Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.topCenter,
              children: [
                Positioned(
                  bottom: 0,
                  child: Transform.scale(
                    scale: shadowScale,
                    child: Container(
                      width: 24,
                      height: 8,
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.28),
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
                Transform.translate(
                  offset: Offset(0, dy),
                  child: CustomPaint(
                    key: const ValueKey('pin-drop-paint'),
                    size: const Size(PinDropMarker.width, PinDropMarker.height),
                    painter: PinDropPainter(color: widget.color),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class PinDropPainter extends CustomPainter {
  PinDropPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final r = w / 2 - 2;
    final path = Path()
      ..moveTo(w / 2, h - 1)
      ..cubicTo(w * 0.2, h * 0.68, 2, h * 0.5, 2, r + 1)
      ..arcToPoint(Offset(w - 2, r + 1), radius: Radius.circular(r))
      ..cubicTo(w - 2, h * 0.5, w * 0.8, h * 0.68, w / 2, h - 1)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
    canvas.drawPath(
        path,
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3);
    canvas.drawCircle(Offset(w / 2, r + 1), 7, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(PinDropPainter old) => old.color != color;
}
