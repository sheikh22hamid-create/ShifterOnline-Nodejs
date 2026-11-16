import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../theme/widgets/truck_road.dart';
import '../../../utils/booking_guarantee.dart' show rupeesText;
import '../../../utils/colors.dart' show notifier;

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

  /// The pickup the customer chose wins over the GPS reverse-geocoded address.
  static String? pickupLine({required String? confirmedPickup, required String? gpsAddress}) =>
      (confirmedPickup != null && confirmedPickup.trim().isNotEmpty) ? confirmedPickup : gpsAddress;

  /// How far the route card overlaps the bottom of this header (home.dart uses the same value).
  static const double overlap = 72;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final shownAddress = (address == null || address!.trim().isEmpty) ? 'Location'.tr : address!;
    final isDark = notifier.getIsDark == true;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: (isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
          .copyWith(statusBarColor: Colors.transparent),
      child: ClipRect(
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
              padding: EdgeInsets.fromLTRB(20, 14 + MediaQuery.paddingOf(context).top, 20, overlap + 56),
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
            const Positioned(
              key: ValueKey('home-header-truck'),
              left: 0,
              right: 0,
              bottom: overlap + 4,
              height: 44,
              child: RepaintBoundary(child: TruckRoad()),
            ),
          ],
        ),
      ),
      ),
    );
  }
}

