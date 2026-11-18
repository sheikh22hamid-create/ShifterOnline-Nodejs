import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// "Offers & Details" card on Select Vehicle (owner decision 2026-11-18): goods type, coupon, reward points
/// and GST as Porter-style rows in one white card. Presentational only — the screen keeps all the state
/// and the payable maths; every row calls the screen's existing handler.
class OffersDetailsCard extends StatelessWidget {
  const OffersDetailsCard({
    super.key,
    required this.goodsValue,
    required this.onGoodsTap,
    required this.couponLabel,
    required this.couponActive,
    required this.onCouponTap,
    this.onCouponClear,
    this.pointsLabel,
    this.pointsActive = false,
    this.onPointsTap,
    required this.gstSection,
  });

  final String goodsValue;
  final VoidCallback onGoodsTap;
  final String couponLabel;
  final bool couponActive;
  final VoidCallback onCouponTap;
  final VoidCallback? onCouponClear;

  /// Null hides the Reward Points row (customer has no redeemable points).
  final String? pointsLabel;
  final bool pointsActive;
  final VoidCallback? onPointsTap;

  /// The existing GST widget, placed as the last row.
  final Widget gstSection;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final divider = Divider(height: 1, color: p.divider);
    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
            child: Text('Offers & Details'.tr, style: AppText.section(p.ink)),
          ),
          _row(
            p,
            icon: Icons.inventory_2_outlined,
            title: 'Goods type'.tr,
            value: goodsValue,
            valueColor: p.inkMuted,
            onTap: onGoodsTap,
          ),
          divider,
          _row(
            p,
            icon: Icons.local_offer_outlined,
            title: couponLabel,
            onTap: onCouponTap,
            trailing: couponActive && onCouponClear != null
                ? IconButton(
                    tooltip: 'Remove coupon'.tr,
                    icon: Icon(Icons.close_rounded, color: p.inkSubtle, size: 20),
                    onPressed: onCouponClear,
                  )
                : null,
          ),
          if (pointsLabel != null) ...[
            divider,
            _row(
              p,
              icon: Icons.stars_rounded,
              title: 'Reward Points'.tr,
              value: pointsLabel,
              valueColor: p.brandText,
              onTap: onPointsTap ?? () {},
              trailing: Padding(
                padding: const EdgeInsets.all(10),
                child: Icon(
                  pointsActive ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                  color: pointsActive ? p.brand : p.inkSubtle,
                  size: 22,
                ),
              ),
            ),
          ],
          divider,
          Padding(padding: const EdgeInsets.fromLTRB(10, 10, 10, 10), child: gstSection),
        ],
      ),
    );
  }

  Widget _row(
    AppPalette p, {
    required IconData icon,
    required String title,
    String? value,
    Color? valueColor,
    required VoidCallback onTap,
    Widget? trailing,
  }) {
    return PressableScale(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, size: 19, color: p.brandText),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 15)),
                    if (value != null && value.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(value, style: AppText.caption(valueColor ?? p.inkMuted).copyWith(fontSize: 13)),
                    ],
                  ],
                ),
              ),
              trailing ?? Padding(
                padding: const EdgeInsets.all(10),
                child: Icon(Icons.chevron_right_rounded, color: p.ink, size: 22),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
