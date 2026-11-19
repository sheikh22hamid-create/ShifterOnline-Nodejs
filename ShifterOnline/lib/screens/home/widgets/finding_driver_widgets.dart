import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/route_marker.dart';
import '../vehicle_booking_animation.dart';

/// White used for things drawn ON the orange hero band (clouds, speed lines, lane, buttons).
/// The band is brand orange in both themes, so this white is theme-independent.
const Color _onBandWhite = Color(0xFFFFFFFF);

/// 3D vehicle image (owner-generated, prompts V1–V4) for a booked vehicle kind.
String vehicleArtFor(BookedVehicleKind kind) => switch (kind) {
      BookedVehicleKind.bike => 'assets/v2/vehicle_bike.png',
      BookedVehicleKind.eLoader => 'assets/v2/vehicle_e_loader.png',
      BookedVehicleKind.threeWheeler => 'assets/v2/vehicle_three_wheeler.png',
      BookedVehicleKind.fourWheeler => 'assets/v2/vehicle_four_wheeler.png',
    };

bool _reduceMotion(BuildContext context) => MediaQuery.maybeDisableAnimationsOf(context) ?? false;

/// Repeating controllers that start only when motion is allowed, and stop when it is turned off.
mixin _LoopingControllers<T extends StatefulWidget> on State<T>, TickerProviderStateMixin<T> {
  final List<AnimationController> _loops = [];

  AnimationController loop(Duration d) {
    final c = AnimationController(vsync: this, duration: d);
    _loops.add(c);
    return c;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final still = _reduceMotion(context);
    for (final c in _loops) {
      if (still) {
        c.stop();
      } else if (!c.isAnimating) {
        c.repeat();
      }
    }
  }

  @override
  void dispose() {
    for (final c in _loops) {
      c.dispose();
    }
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/// Orange band with a vehicle driving on a road: clouds, a scrolling skyline, a dashed lane.
class FindingDriverHero extends StatefulWidget {
  const FindingDriverHero({super.key, required this.vehicleName, required this.onBack, required this.onHome});

  final String vehicleName;
  final VoidCallback onBack;
  final VoidCallback onHome;

  static const double height = 318;

  @override
  State<FindingDriverHero> createState() => _FindingDriverHeroState();
}

const List<double> _buildingHeights = [38, 56, 30, 64, 44, 52, 28, 60, 40, 48, 34, 58];

class _FindingDriverHeroState extends State<FindingDriverHero>
    with TickerProviderStateMixin, _LoopingControllers<FindingDriverHero> {
  late final AnimationController _cloud = loop(const Duration(seconds: 14));
  late final AnimationController _city = loop(const Duration(seconds: 18));
  late final AnimationController _lane = loop(const Duration(milliseconds: 600));
  late final AnimationController _drive = loop(const Duration(milliseconds: 900));

  @override
  void initState() {
    super.initState();
    // Touch the lazies so the mixin knows every loop before didChangeDependencies.
    _cloud;
    _city;
    _lane;
    _drive;
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final still = _reduceMotion(context);
    final road = Color.alphaBlend(p.onBrand.withValues(alpha: .10), p.brand);
    final skyline = p.onBrand.withValues(alpha: .28);

    return ClipRRect(
      borderRadius: const BorderRadius.vertical(bottom: Radius.circular(28)),
      child: Container(
        height: FindingDriverHero.height,
        color: p.brand,
        child: LayoutBuilder(builder: (context, box) {
          final w = box.maxWidth;
          return Stack(
            clipBehavior: Clip.hardEdge,
            children: [
              // Clouds drift right → left.
              _cloudAt(w, top: 70, width: 70, height: 22, alpha: .55, period: 1.0, phase: 0),
              _cloudAt(w, top: 108, width: 46, height: 16, alpha: .45, period: 20 / 14, phase: .4),
              _cloudAt(w, top: 54, width: 54, height: 18, alpha: .40, period: 17 / 14, phase: .76),

              // Skyline, two copies for a seamless loop.
              Positioned(
                left: 0,
                right: 0,
                bottom: 92,
                height: 70,
                child: ClipRect(
                  child: AnimatedBuilder(
                    animation: _city,
                    builder: (_, child) => OverflowBox(
                      alignment: Alignment.bottomLeft,
                      maxWidth: double.infinity,
                      child: Transform.translate(offset: Offset(-_city.value * _skylineWidth, 0), child: child),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [_skyline(skyline), _skyline(skyline)],
                    ),
                  ),
                ),
              ),

              // Road with a dashed lane.
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                height: 92,
                child: Container(
                  color: road,
                  alignment: Alignment.topLeft,
                  padding: const EdgeInsets.only(top: 44),
                  child: SizedBox(
                    height: 5,
                    width: double.infinity,
                    child: AnimatedBuilder(
                      animation: _lane,
                      builder: (_, __) => CustomPaint(painter: _LanePainter(_lane.value)),
                    ),
                  ),
                ),
              ),

              // Vehicle, speed lines and ground shadow.
              Positioned(
                left: 0,
                right: 0,
                bottom: 46,
                child: AnimatedBuilder(
                  animation: _drive,
                  builder: (_, child) {
                    final t = _drive.value;
                    final bob = still ? 0.0 : -3 * math.sin(t * 2 * math.pi).abs();
                    final tilt = still ? 0.0 : 0.01 * math.sin(t * 2 * math.pi);
                    final shadowScale = still ? 1.0 : 1 - 0.1 * math.sin(t * math.pi);
                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 178 + 60,
                          height: 116,
                          child: Stack(
                            clipBehavior: Clip.none,
                            children: [
                              if (!still) ...[
                                _speedLine(t, 0, width: 36, left: 14, top: 40),
                                _speedLine(t, .33, width: 24, left: 22, top: 62),
                                _speedLine(t, .66, width: 30, left: 8, top: 82),
                              ],
                              Positioned(
                                left: 60,
                                top: 0,
                                width: 178,
                                height: 116,
                                child: Transform.translate(
                                  offset: Offset(0, bob),
                                  child: Transform.rotate(angle: tilt, child: child),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 4),
                        Transform.scale(
                          scaleX: shadowScale,
                          child: Container(
                            width: 130,
                            height: 12,
                            decoration: BoxDecoration(
                              color: p.onBrand.withValues(alpha: .26),
                              borderRadius: const BorderRadius.all(Radius.elliptical(65, 6)),
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                  child: _vehicle(p, still),
                ),
              ),

              // Top row: back + Go to Home.
              Positioned(
                left: 16,
                right: 16,
                top: 14,
                child: SafeArea(
                  bottom: false,
                  child: Row(
                    children: [
                      Semantics(
                        button: true,
                        label: 'Back'.tr,
                        excludeSemantics: true,
                        child: Material(
                          color: _onBandWhite,
                          shape: const CircleBorder(),
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: widget.onBack,
                            child: SizedBox(
                              width: 44,
                              height: 44,
                              child: Icon(Icons.arrow_back_rounded, size: 20, color: p.onBrand),
                            ),
                          ),
                        ),
                      ),
                      const Spacer(),
                      Material(
                        color: _onBandWhite,
                        shape: const StadiumBorder(),
                        child: InkWell(
                          customBorder: const StadiumBorder(),
                          onTap: widget.onHome,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 40),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                              child: Center(
                                widthFactor: 1,
                                child: Text('Go to Home'.tr, style: AppText.bodyStrong(p.onBrand).copyWith(fontSize: 14)),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        }),
      ),
    );
  }

  Widget _vehicle(AppPalette p, bool still) {
    Widget fallback() => TickerMode(
          enabled: !still,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: VehicleBookingAnimation(
              vehicleName: widget.vehicleName,
              height: 110,
              showLabel: false,
              backgroundColor: p.brandTint,
            ),
          ),
        );
    return Image.asset(
      vehicleArtFor(bookedVehicleKindFor(widget.vehicleName)),
      height: 116,
      fit: BoxFit.contain,
      errorBuilder: (_, __, ___) => fallback(),
    );
  }

  Widget _cloudAt(double w,
      {required double top,
      required double width,
      required double height,
      required double alpha,
      required double period,
      required double phase}) {
    return AnimatedBuilder(
      animation: _cloud,
      builder: (_, child) {
        final t = ((_cloud.value / period) + phase) % 1.0;
        final left = (w + 30) - t * (w + 30 + width + 30);
        return Positioned(left: left, top: top, child: child!);
      },
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: _onBandWhite.withValues(alpha: alpha),
          borderRadius: BorderRadius.circular(height),
        ),
      ),
    );
  }

  Widget _speedLine(double t, double delay, {required double width, required double left, required double top}) {
    final k = (t + 1 - delay) % 1.0;
    final opacity = k < .3 ? (k / .3) * .9 : .9 * (1 - (k - .3) / .7);
    return Positioned(
      left: left - 60 * k,
      top: top,
      child: Opacity(
        opacity: opacity.clamp(0.0, 1.0),
        child: Container(
          width: width,
          height: 3,
          decoration: BoxDecoration(color: _onBandWhite, borderRadius: BorderRadius.circular(2)),
        ),
      ),
    );
  }
}

const double _buildingGap = 6;

List<Size> _buildings() => List.generate(24, (i) {
      final w = 22.0 + ((i * 7) % 18);
      return Size(w, _buildingHeights[i % _buildingHeights.length]);
    });

final double _skylineWidth = _buildings().fold<double>(0, (s, b) => s + b.width + _buildingGap);

Widget _skyline(Color color) => Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (final b in _buildings())
          Padding(
            padding: const EdgeInsets.only(right: _buildingGap),
            child: Container(
              width: b.width,
              height: b.height,
              decoration: BoxDecoration(
                color: color,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
              ),
            ),
          ),
      ],
    );

class _LanePainter extends CustomPainter {
  _LanePainter(this.t);
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = _onBandWhite.withValues(alpha: .85);
    const dash = 48.0, period = 96.0;
    for (var x = -t * period; x < size.width; x += period) {
      canvas.drawRect(Rect.fromLTWH(x, 0, dash, size.height), paint);
    }
  }

  @override
  bool shouldRepaint(_LanePainter old) => old.t != t;
}

// ---------------------------------------------------------------------------
// Stage message
// ---------------------------------------------------------------------------

/// The rotating line under the title: a new text fades in and slides up 8 px.
class StageMessage extends StatelessWidget {
  const StageMessage({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 500),
      switchInCurve: Curves.easeOut,
      transitionBuilder: (child, anim) => FadeTransition(
        opacity: anim,
        child: AnimatedBuilder(
          animation: anim,
          builder: (_, c) => Transform.translate(offset: Offset(0, 8 * (1 - anim.value)), child: c),
          child: child,
        ),
      ),
      child: Text(
        text,
        key: ValueKey(text),
        textAlign: TextAlign.center,
        style: AppText.body(p.inkMuted).copyWith(fontSize: 14, height: 1.4),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Progress card
// ---------------------------------------------------------------------------

/// Orange bar (never full until a driver accepts) with a shimmer, plus 3 steps.
class SearchProgressCard extends StatefulWidget {
  const SearchProgressCard({super.key, required this.progress, required this.notified});

  /// 0..1 bar fill.
  final double progress;
  final bool notified;

  @override
  State<SearchProgressCard> createState() => _SearchProgressCardState();
}

class _SearchProgressCardState extends State<SearchProgressCard>
    with TickerProviderStateMixin, _LoopingControllers<SearchProgressCard> {
  late final AnimationController _shimmer = loop(const Duration(milliseconds: 1800));

  @override
  void initState() {
    super.initState();
    _shimmer;
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final still = _reduceMotion(context);
    final value = widget.progress.clamp(0.0, 1.0).toDouble();
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: Container(
              height: 8,
              color: p.brandTint,
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                key: const Key('search-progress-fill'),
                widthFactor: value,
                heightFactor: 1,
                child: Container(
                  color: p.brand,
                  child: still
                      ? null
                      : LayoutBuilder(
                          builder: (_, box) => AnimatedBuilder(
                            animation: _shimmer,
                            builder: (_, __) {
                              final t = Curves.easeInOut.transform(_shimmer.value);
                              final sw = box.maxWidth * .3;
                              return Stack(clipBehavior: Clip.hardEdge, children: [
                                Positioned(
                                  left: -1.2 * sw + t * (box.maxWidth + 1.2 * sw),
                                  top: 0,
                                  bottom: 0,
                                  width: sw,
                                  child: DecoratedBox(
                                    decoration: BoxDecoration(
                                      gradient: LinearGradient(colors: [
                                        _onBandWhite.withValues(alpha: 0),
                                        _onBandWhite.withValues(alpha: .65),
                                        _onBandWhite.withValues(alpha: 0),
                                      ]),
                                    ),
                                  ),
                                ),
                              ]);
                            },
                          ),
                        ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _Step(label: 'Order placed'.tr, done: true)),
              Expanded(child: _Step(label: 'Drivers notified'.tr, done: widget.notified, pop: true)),
              Expanded(child: _Step(label: 'Driver accepts'.tr, done: false)),
            ],
          ),
        ],
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.label, required this.done, this.pop = false});
  final String label;
  final bool done;
  final bool pop;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final still = _reduceMotion(context);
    Widget dot = Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done ? p.brand : p.surface,
        border: done ? null : Border.all(color: p.line, width: 2),
      ),
      child: done ? Icon(Icons.check_rounded, size: 14, color: p.onBrand) : null,
    );
    if (done && pop && !still) {
      dot = TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: const Duration(milliseconds: 450),
        builder: (_, t, child) {
          final s = t < .7 ? .4 + (1.15 - .4) * (t / .7) : 1.15 - .15 * ((t - .7) / .3);
          return Opacity(opacity: (t / .7).clamp(0.0, 1.0), child: Transform.scale(scale: s, child: child));
        },
        child: dot,
      );
    }
    return Column(
      children: [
        dot,
        const SizedBox(height: 6),
        Text(
          label,
          textAlign: TextAlign.center,
          style: AppText.caption(done ? p.ink : p.inkSubtle).copyWith(fontFamily: done ? 'Gilroy_Bold' : null),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Trip card
// ---------------------------------------------------------------------------

/// What was booked: vehicle, order id + fare, pickup and drop. Missing parts are hidden.
class WaitingTripCard extends StatelessWidget {
  const WaitingTripCard({super.key, this.vehicle, required this.orderId, this.fare, this.pickup, this.drop});

  final String? vehicle;
  final String orderId;
  final String? fare;
  final String? pickup;
  final String? drop;

  static bool _has(String? s) => s != null && s.trim().isNotEmpty && s.trim() != 'null';

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final idLine = _has(fare) ? '${'Order'.tr} #$orderId · ${fare!.trim()}' : '${'Order'.tr} #$orderId';
    Widget place(Widget marker, String text) => Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Row(children: [
            marker,
            const SizedBox(width: 10),
            Expanded(
              child: Text(text.trim(),
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body(p.ink).copyWith(fontSize: 14)),
            ),
          ]),
        );
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_has(vehicle)) Text(vehicle!.trim(), style: AppText.bodyStrong(p.ink)),
          Text(idLine, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
          if (_has(pickup)) place(const RouteMarker.pickup(size: 20), pickup!),
          if (_has(drop)) place(const RouteMarker.drop(size: 20), drop!),
        ],
      ),
    );
  }
}
