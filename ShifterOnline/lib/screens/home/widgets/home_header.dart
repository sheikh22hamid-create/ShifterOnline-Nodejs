import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../utils/booking_guarantee.dart' show rupeesText;

/// Top of the Home tab: pickup location, wallet chip, notifications, heading and the moving truck.
/// Presentational only — every tap goes to a callback owned by home.dart.
class HomeHeader extends StatelessWidget {
  const HomeHeader({
    super.key,
    required this.address,
    required this.onLocationTap,
    required this.onNotificationTap,
    this.walletBalance,
    this.onWalletTap,
  });

  final String? address;
  final VoidCallback onLocationTap;
  final VoidCallback onNotificationTap;
  final double? walletBalance;
  final VoidCallback? onWalletTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final shownAddress = (address == null || address!.trim().isEmpty) ? 'Location'.tr : address!;
    return ClipRect(
      child: ColoredBox(
        color: p.brandTint,
        child: Stack(
          children: [
            Positioned(
              right: -70,
              top: -90,
              child: ExcludeSemantics(
                child: Container(
                  width: 240,
                  height: 240,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: p.brand.withValues(alpha: 0.08)),
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(20, 14 + MediaQuery.paddingOf(context).top, 20, 92),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: PressableScale(
                          onTap: onLocationTap,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 44),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Picking up from'.tr, style: AppText.caption(p.inkMuted)),
                                const SizedBox(height: 2),
                                Row(
                                  children: [
                                    Icon(Icons.location_on_outlined, size: 18, color: p.brand),
                                    const SizedBox(width: 4),
                                    Flexible(
                                      child: Text(
                                        shownAddress,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: AppText.bodyStrong(p.ink).copyWith(fontSize: 17),
                                      ),
                                    ),
                                    Icon(Icons.keyboard_arrow_down_rounded, size: 20, color: p.ink),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      if (walletBalance != null) ...[
                        const SizedBox(width: AppSpace.s),
                        PressableScale(
                          onTap: onWalletTap,
                          semanticLabel: 'Wallet balance'.tr,
                          child: Container(
                            height: 36,
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            decoration: BoxDecoration(
                              color: p.surface,
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(color: p.brand.withValues(alpha: 0.25)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.account_balance_wallet_outlined, size: 16, color: p.brand),
                                const SizedBox(width: 6),
                                Text(rupeesText(walletBalance!), style: AppText.bodyStrong(p.ink).copyWith(fontSize: 13)),
                              ],
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(width: AppSpace.s),
                      PressableScale(
                        onTap: onNotificationTap,
                        semanticLabel: 'Notifications'.tr,
                        child: Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: p.surface,
                            shape: BoxShape.circle,
                            border: Border.all(color: p.brand.withValues(alpha: 0.25)),
                          ),
                          child: Icon(Icons.notifications_none_rounded, size: 22, color: p.ink),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Text('What are we moving today?'.tr, style: AppText.hero(p.ink)),
                ],
              ),
            ),
            const Positioned(left: 0, right: 0, bottom: 18, height: 44, child: RepaintBoundary(child: _TruckRoad())),
          ],
        ),
      ),
    );
  }
}

class _TruckRoad extends StatefulWidget {
  const _TruckRoad();

  @override
  State<_TruckRoad> createState() => _TruckRoadState();
}

class _TruckRoadState extends State<_TruckRoad> with SingleTickerProviderStateMixin {
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
          painter: _TruckRoadPainter(progress: _controller.value, brand: p.brand, road: p.brand.withValues(alpha: 0.35)),
        ),
      ),
    );
  }
}

class _TruckRoadPainter extends CustomPainter {
  _TruckRoadPainter({required this.progress, required this.brand, required this.road});

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
  bool shouldRepaint(_TruckRoadPainter old) =>
      old.progress != progress || old.brand != brand || old.road != road;
}
