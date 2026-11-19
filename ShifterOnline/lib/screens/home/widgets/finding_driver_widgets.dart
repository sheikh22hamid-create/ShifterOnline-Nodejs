import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/route_marker.dart';

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
// Searching card (Porter-style: icon, "Searching for drivers nearby…", 3 segments)
// ---------------------------------------------------------------------------

/// Fill (0..1) of each of [count] segments for an overall [bar] (0..1); they fill one after another.
List<double> segmentFills(double bar, {int count = 3}) {
  final v = bar.clamp(0.0, 1.0) * count;
  return [for (var i = 0; i < count; i++) (v - i).clamp(0.0, 1.0).toDouble()];
}

/// The card on the sheet while a driver is searched: a gently scanning search icon, the title, the
/// truthful stage message, and a 3-part bar (never full until a driver accepts).
class SearchingCard extends StatefulWidget {
  const SearchingCard({super.key, required this.bar, required this.stage, required this.message});

  /// Overall progress 0..1 (from searchBar).
  final double bar;

  /// 0..3; 3 = late ("Still searching…").
  final int stage;
  final String message;

  @override
  State<SearchingCard> createState() => _SearchingCardState();
}

class _SearchingCardState extends State<SearchingCard>
    with TickerProviderStateMixin, _LoopingControllers<SearchingCard> {
  late final AnimationController _scan = loop(const Duration(milliseconds: 2400));
  late final AnimationController _shimmer = loop(const Duration(milliseconds: 1600));

  @override
  void initState() {
    super.initState();
    _scan;
    _shimmer;
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final still = _reduceMotion(context);
    final fills = segmentFills(widget.bar);
    final active = fills.indexWhere((f) => f < 1);

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 18),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.hero),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        children: [
          // Search icon that slowly circles, like it is scanning the area.
          SizedBox(
            width: 64,
            height: 64,
            child: DecoratedBox(
              decoration: BoxDecoration(color: p.brandTint, shape: BoxShape.circle),
              child: AnimatedBuilder(
                animation: _scan,
                builder: (_, child) {
                  final a = _scan.value * 2 * math.pi;
                  final o = still ? Offset.zero : Offset(math.cos(a) * 5, math.sin(a) * 5);
                  return Transform.translate(offset: o, child: child);
                },
                // Lens showing the map, then a driver inside it ("we are looking for your driver").
                child: SizedBox(
                  width: 40,
                  height: 40,
                  child: Stack(
                    children: [
                      Icon(Icons.search_rounded, size: 40, color: p.brandText),
                      Align(
                        alignment: const Alignment(-0.2, -0.22),
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 300),
                          child: Icon(
                            still || _scan.value < .5 ? Icons.map_rounded : Icons.person_rounded,
                            key: ValueKey(still || _scan.value < .5),
                            size: 13,
                            color: p.brandText,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 400),
            child: Text(
              (widget.stage >= 3 ? 'Still searching for drivers nearby…' : 'Searching for drivers nearby…').tr,
              key: ValueKey(widget.stage >= 3),
              textAlign: TextAlign.center,
              style: AppText.section(p.ink).copyWith(fontSize: 19),
            ),
          ),
          const SizedBox(height: 6),
          StageMessage(text: widget.message),
          const SizedBox(height: 16),
          Row(
            children: [
              for (var i = 0; i < fills.length; i++) ...[
                if (i > 0) const SizedBox(width: 8),
                Expanded(child: _segment(p, i, fills[i], shimmer: !still && i == active)),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _segment(AppPalette p, int i, double fill, {required bool shimmer}) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(3),
      child: Container(
        height: 6,
        color: p.brandTint,
        alignment: Alignment.centerLeft,
        child: TweenAnimationBuilder<double>(
          // Smoothly glide to the new fill each second instead of jumping.
          tween: Tween(end: fill),
          duration: const Duration(milliseconds: 900),
          curve: Curves.easeOut,
          builder: (_, f, __) => FractionallySizedBox(
            key: Key('search-segment-$i'),
            widthFactor: fill == 0 ? 0 : f,
            heightFactor: 1,
            child: Container(
              color: p.brand,
              child: !shimmer
                  ? null
                  : LayoutBuilder(
                      builder: (_, box) => AnimatedBuilder(
                        animation: _shimmer,
                        builder: (_, __) {
                          final t = Curves.easeInOut.transform(_shimmer.value);
                          final sw = math.max(box.maxWidth * .5, 24.0);
                          return Stack(clipBehavior: Clip.hardEdge, children: [
                            Positioned(
                              left: -sw + t * (box.maxWidth + sw),
                              top: 0,
                              bottom: 0,
                              width: sw,
                              child: const DecoratedBox(
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(colors: [
                                    Color(0x00FFFFFF),
                                    Color(0xA6FFFFFF),
                                    Color(0x00FFFFFF),
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

// ---------------------------------------------------------------------------
// Booking confirmed (shown once, right after "Book")
// ---------------------------------------------------------------------------

/// Full-screen moment after booking: a green tick pops in with confetti, then the overlay fades away
/// by itself. It ignores taps, so it never blocks the screen below. No saving is claimed here.
class BookingConfirmedOverlay extends StatefulWidget {
  const BookingConfirmedOverlay({super.key});

  @override
  State<BookingConfirmedOverlay> createState() => _BookingConfirmedOverlayState();
}

class _BookingConfirmedOverlayState extends State<BookingConfirmedOverlay> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this);
  bool _gone = false;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    final still = _reduceMotion(context);
    _c.duration = Duration(milliseconds: still ? 800 : 1900);
    _c.forward().whenComplete(() {
      if (mounted) setState(() => _gone = true);
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_gone) return const SizedBox.shrink();
    final p = AppPalette.current;
    final still = _reduceMotion(context);
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _c,
        builder: (_, __) {
          final t = _c.value;
          // Fade out over the last 25 %.
          final fade = t < .75 ? 1.0 : (1 - (t - .75) / .25);
          final pop = still ? 1.0 : Curves.elasticOut.transform((t / .35).clamp(0.0, 1.0));
          return Opacity(
            opacity: fade.clamp(0.0, 1.0),
            child: ColoredBox(
              color: p.surface,
              child: Stack(
                children: [
                  if (!still) Positioned.fill(child: CustomPaint(painter: _ConfettiPainter(t, p.brand))),
                  Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Transform.scale(
                          scale: pop,
                          child: Container(
                            width: 96,
                            height: 96,
                            decoration: BoxDecoration(color: p.success, shape: BoxShape.circle),
                            child: const Icon(Icons.check_rounded, size: 58, color: Color(0xFFFFFFFF)),
                          ),
                        ),
                        const SizedBox(height: 20),
                        Text('Booking placed'.tr, style: AppText.title(p.ink)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ConfettiPainter extends CustomPainter {
  _ConfettiPainter(this.t, this.brand);
  final double t;
  final Color brand;

  static final List<_Bit> _bits = List.generate(42, (i) {
    final r = math.Random(i * 7919);
    return _Bit(
      angle: r.nextDouble() * 2 * math.pi,
      speed: .35 + r.nextDouble() * .45,
      spin: (r.nextDouble() - .5) * 10,
      colorIndex: i % 4,
      long: r.nextBool(),
    );
  });

  @override
  void paint(Canvas canvas, Size size) {
    final p = AppPalette.current;
    final colors = [brand, p.success, p.warning, p.brandText];
    final centre = Offset(size.width / 2, size.height / 2 - 20);
    final burst = Curves.easeOutCubic.transform((t / .6).clamp(0.0, 1.0));
    final reach = size.shortestSide * .55;
    for (final b in _bits) {
      final d = reach * b.speed * burst;
      final pos = centre + Offset(math.cos(b.angle) * d, math.sin(b.angle) * d + 140 * t * t);
      canvas.save();
      canvas.translate(pos.dx, pos.dy);
      canvas.rotate(b.spin * t);
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromCenter(center: Offset.zero, width: b.long ? 10 : 6, height: 4), const Radius.circular(1.5)),
        Paint()..color = colors[b.colorIndex].withValues(alpha: (1 - t).clamp(0.0, 1.0)),
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_ConfettiPainter old) => old.t != t;
}

class _Bit {
  const _Bit({required this.angle, required this.speed, required this.spin, required this.colorIndex, required this.long});
  final double angle, speed, spin;
  final int colorIndex;
  final bool long;
}

// ---------------------------------------------------------------------------
// Fare + help
// ---------------------------------------------------------------------------

/// "Total fare ₹X", a "You saved ₹Y" line only when a real coupon saving exists, and "Need help?".
class WaitingFareCard extends StatelessWidget {
  const WaitingFareCard({super.key, required this.fare, required this.saved, required this.onHelp});

  final String? fare;
  final double saved;
  final VoidCallback onHelp;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final hasFare = fare != null && fare!.trim().isNotEmpty;
    final savedText = saved == saved.roundToDouble() ? saved.toStringAsFixed(0) : saved.toStringAsFixed(2);
    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        children: [
          if (hasFare)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: p.successTint, borderRadius: BorderRadius.circular(10)),
                    child: Icon(Icons.payments_outlined, color: p.successText, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Total fare'.tr, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
                        if (saved > 0)
                          Text('${'You saved'.tr} ₹$savedText ${'on this order'.tr}',
                              style: AppText.caption(p.successText).copyWith(fontFamily: 'Gilroy_Bold')),
                      ],
                    ),
                  ),
                  Text(fare!.trim(), style: AppText.section(p.ink)),
                ],
              ),
            ),
          if (hasFare) Divider(height: 1, color: p.divider),
          InkWell(
            onTap: onHelp,
            borderRadius: BorderRadius.circular(AppRadius.card),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 52),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                child: Row(
                  children: [
                    Icon(Icons.support_agent_rounded, color: p.inkMuted, size: 22),
                    const SizedBox(width: 12),
                    Expanded(child: Text('Need help?'.tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14))),
                    Text('Contact Support'.tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 13.5)),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
