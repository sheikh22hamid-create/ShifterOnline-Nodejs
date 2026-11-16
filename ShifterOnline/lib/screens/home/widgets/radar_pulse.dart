import 'package:flutter/material.dart';

/// Expanding radar rings shown while we look for a driver. One still ring when motion is reduced.
class RadarPulse extends StatefulWidget {
  const RadarPulse({super.key, required this.color, this.size = 300, this.rings = 3, this.child});

  final Color color;
  final double size;
  final int rings;
  /// Drawn in the centre (e.g. the pickup pin).
  final Widget? child;

  @override
  State<RadarPulse> createState() => _RadarPulseState();
}

class _RadarPulseState extends State<RadarPulse> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 2400));
  bool _reduceMotion = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (_reduceMotion) {
      _controller.stop();
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
    return ExcludeSemantics(
      child: RepaintBoundary(
        child: SizedBox(
          width: widget.size,
          height: widget.size,
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) => Stack(
              alignment: Alignment.center,
              children: [
                for (var i = 0; i < widget.rings; i++)
                  Builder(builder: (context) {
                    final t = _reduceMotion ? 0.6 : (_controller.value + i / widget.rings) % 1.0;
                    final d = widget.size * (0.2 + 0.8 * t);
                    return Container(
                      key: const ValueKey('radar-ring'),
                      width: d,
                      height: d,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: widget.color.withValues(alpha: 0.18 * (1 - t)),
                        border: Border.all(color: widget.color.withValues(alpha: 0.5 * (1 - t)), width: 2),
                      ),
                    );
                  }),
                if (widget.child != null) widget.child!,
              ],
            ),
          ),
        ),
      ),
    );
  }
}
