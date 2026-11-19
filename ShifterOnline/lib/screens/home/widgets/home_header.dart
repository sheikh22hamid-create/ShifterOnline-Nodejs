import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../theme/widgets/v2_art.dart';
import '../../../utils/booking_guarantee.dart' show rupeesText;

/// Top of the Home tab (v2, Porter-style): solid brand-orange band with the logo, wallet chip,
/// notifications, headline and the H1 illustration. The pickup card overlaps its bottom [overlap] px.
/// Presentational only — every tap goes to a callback owned by home.dart.
class HomeHeader extends StatelessWidget {
  const HomeHeader({
    super.key,
    required this.onNotificationTap,
    this.walletBalance,
    this.onWalletTap,
  });

  final VoidCallback onNotificationTap;
  final double? walletBalance;
  final VoidCallback? onWalletTap;

  /// The pickup the customer chose wins over the GPS reverse-geocoded address.
  static String? pickupLine({required String? confirmedPickup, required String? gpsAddress}) =>
      (confirmedPickup != null && confirmedPickup.trim().isNotEmpty) ? confirmedPickup : gpsAddress;

  /// How far the pickup card overlaps the bottom of this header (home.dart uses the same value).
  static const double overlap = 30;

  static const Color _sub = Color(0xFF3A1A0B);

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      // Dark icons read best on the orange band in both themes.
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: p.brand,
          borderRadius: const BorderRadius.vertical(bottom: Radius.circular(24)),
        ),
        child: Padding(
          padding: EdgeInsets.fromLTRB(20, 14 + top, 20, overlap + 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text('Shifter',
                        maxLines: 1, style: AppText.title(p.onBrand).copyWith(fontSize: 27, letterSpacing: -0.4)),
                  ),
                  if (walletBalance != null) ...[
                    PressableScale(
                      onTap: onWalletTap,
                      semanticLabel: 'Wallet balance'.tr,
                      child: Container(
                        height: 36,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(18),
                          boxShadow: AppShadow.card,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.account_balance_wallet_outlined, size: 16, color: Color(0xFF15171C)),
                            const SizedBox(width: 6),
                            Text(rupeesText(walletBalance!),
                                style: AppText.bodyStrong(const Color(0xFF15171C)).copyWith(fontSize: 13)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpace.s),
                  ],
                  PressableScale(
                    onTap: onNotificationTap,
                    semanticLabel: 'Notifications'.tr,
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: AppShadow.card,
                      ),
                      child: const Icon(Icons.notifications_none_rounded, size: 22, color: Color(0xFF15171C)),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Move anything,\nanywhere'.tr,
                            style: AppText.title(p.onBrand).copyWith(fontSize: 28, height: 1.15, letterSpacing: -0.5)),
                        const SizedBox(height: 6),
                        Text('Trucks, tempos and bikes'.tr,
                            maxLines: 2, style: AppText.body(_sub).copyWith(fontSize: 15)),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpace.s),
                  // Bigger art that runs to the screen's right edge (the shop is cut there on purpose).
                  Transform.translate(
                    offset: const Offset(20, 0),
                    child: const V2Art(asset: 'assets/v2/home_header.png', placeholderLabel: 'H1', width: 150, height: 124),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
