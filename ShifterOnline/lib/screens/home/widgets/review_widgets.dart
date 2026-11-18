import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/app_buttons.dart';
import '../../../theme/widgets/app_sheet.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../theme/widgets/route_marker.dart';

/// Review Booking (Porter style) building blocks. Presentational only — confirm_order_map.dart keeps the
/// payment state and `_handleConfirmOrder`.

/// Vehicle + time card with "View Address Details".
class ReviewVehicleCard extends StatelessWidget {
  const ReviewVehicleCard({
    super.key,
    required this.vehicleName,
    this.imageUrl,
    this.timeLabel,
    required this.onViewAddress,
  });

  final String vehicleName;
  final String? imageUrl;
  final String? timeLabel;
  final VoidCallback onViewAddress;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final placeholder = Icon(Icons.local_shipping_outlined, color: p.inkSubtle, size: 34);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Row(
        children: [
          SizedBox(
            width: 64,
            height: 64,
            child: (imageUrl == null || imageUrl!.isEmpty)
                ? Center(child: placeholder)
                : Image.network(imageUrl!,
                    fit: BoxFit.contain, cacheWidth: 300, errorBuilder: (_, __, ___) => Center(child: placeholder)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(vehicleName, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 17)),
                if (timeLabel != null && timeLabel!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(Icons.schedule_rounded, size: 14, color: p.inkMuted),
                      const SizedBox(width: 4),
                      Flexible(child: Text(timeLabel!, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13))),
                    ],
                  ),
                ],
                const SizedBox(height: 4),
                PressableScale(
                  onTap: onViewAddress,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Text('View Address Details'.tr,
                        style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 13)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Pinned bottom bar: payment method, total + View Breakup, and the Book button.
class ReviewBottomBar extends StatelessWidget {
  const ReviewBottomBar({
    super.key,
    required this.payLabel,
    required this.onPayTap,
    required this.total,
    required this.onViewBreakup,
    required this.buttonLabel,
    required this.processing,
    this.onBook,
  });

  final String payLabel;
  final VoidCallback onPayTap;
  final String total;
  final VoidCallback onViewBreakup;
  final String buttonLabel;
  final bool processing;

  /// Null = disabled.
  final VoidCallback? onBook;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Container(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.paddingOf(context).bottom),
      decoration: BoxDecoration(
        color: p.surface,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 18, offset: const Offset(0, -4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: PressableScale(
                  onTap: onPayTap,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        Icon(Icons.payments_outlined, size: 18, color: p.ink),
                        const SizedBox(width: 6),
                        Flexible(child: Text(payLabel, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14))),
                        Icon(Icons.keyboard_arrow_down_rounded, size: 20, color: p.ink),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(total, style: AppText.title(p.ink).copyWith(fontSize: 19)),
                  PressableScale(
                    onTap: onViewBreakup,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text('View Breakup'.tr,
                          style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 12.5)),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (processing)
            Container(
              height: 52,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: p.brand.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(12),
              ),
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(color: p.onBrand, strokeWidth: 2.4),
              ),
            )
          else
            AppPrimaryButton(label: buttonLabel, onPressed: onBook),
        ],
      ),
    );
  }
}

/// All stops and receivers for this booking (replaces the Review map).
Future<void> showAddressDetailsSheet(
  BuildContext context, {
  Map<String, dynamic>? pickup,
  List<Map<String, dynamic>> stops = const [],
  Map<String, dynamic>? drop,
}) {
  String contact(Map<String, dynamic> d) {
    final name = (d['c_name'] ?? '').toString().trim();
    final number = (d['c_number'] ?? '').toString().trim();
    return [name, number].where((v) => v.isNotEmpty).join(' · ');
  }

  String address(Map<String, dynamic> d) {
    final a = (d['address'] ?? d['c_ddress'] ?? '').toString().trim();
    return a.isNotEmpty ? a : (d['hno'] ?? '').toString();
  }

  Widget row(AppPalette p, Widget marker, Map<String, dynamic> d) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            marker,
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (contact(d).isNotEmpty) Text(contact(d), style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                  Text(address(d), style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
      );

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) {
      final p = AppPalette.current;
      return ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.8),
        child: AppSheet(
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Address details'.tr, style: AppText.section(p.ink)),
                const SizedBox(height: 8),
                if (pickup != null) row(p, const RouteMarker.pickup(), pickup),
                for (var i = 0; i < stops.length; i++) row(p, RouteMarker.stop(i + 1), stops[i]),
                if (drop != null) row(p, const RouteMarker.drop(), drop),
                SizedBox(height: MediaQuery.paddingOf(sheetContext).bottom),
              ],
            ),
          ),
        ),
      );
    },
  );
}
