import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// Select Vehicle top card (Porter style): booking type (Now / Schedule / Low Fare) and the driver search area.
/// Presentational only. `bookingType` uses the screen's values: 1 = Now, 2 = Schedule, 3 = Low Fare.
/// "Change" appears only for Schedule and re-picks the time; switching type means going back to Home.
class BookingTypeCard extends StatelessWidget {
  const BookingTypeCard({
    super.key,
    required this.bookingType,
    this.scheduleLabel,
    this.onChangeSchedule,
    required this.radiusKm,
    required this.onRadiusTap,
    this.lowFareChild,
  });

  final int bookingType;
  final String? scheduleLabel;
  final VoidCallback? onChangeSchedule;
  final int radiusKm;
  final VoidCallback onRadiusTap;

  /// Low Fare date + pickup window pickers (owned by the screen); shown only for Low Fare.
  final Widget? lowFareChild;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final isSchedule = bookingType == 2;
    final (IconData icon, String label) = switch (bookingType) {
      2 => (Icons.schedule_rounded, 'Schedule'.tr),
      3 => (Icons.local_offer_rounded, 'Low Fare'.tr),
      _ => (Icons.bolt_rounded, 'Now'.tr),
    };
    final hasTime = scheduleLabel != null && scheduleLabel!.isNotEmpty;

    Widget typeRow = Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
      child: Row(
        children: [
          _leading(p, icon),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(label, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 15)),
                if (isSchedule) ...[
                  const SizedBox(height: 2),
                  Text(
                    hasTime ? scheduleLabel! : 'Pick pickup date & time'.tr,
                    style: AppText.caption(hasTime ? p.inkMuted : p.brandText).copyWith(fontSize: 13),
                  ),
                ],
              ],
            ),
          ),
          if (isSchedule && hasTime)
            TextButton(
              onPressed: onChangeSchedule,
              style: TextButton.styleFrom(foregroundColor: p.brandText, minimumSize: const Size(44, 44)),
              child: Text('Change'.tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 13)),
            ),
        ],
      ),
    );
    if (isSchedule && !hasTime) typeRow = PressableScale(onTap: onChangeSchedule, child: typeRow);

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
          typeRow,
          if (bookingType == 3 && lowFareChild != null)
            Padding(padding: const EdgeInsets.fromLTRB(14, 0, 14, 12), child: lowFareChild),
          Divider(height: 1, color: p.divider),
          PressableScale(
            onTap: onRadiusTap,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
              child: Row(
                children: [
                  _leading(p, Icons.radar_rounded),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text('Driver search area · @km km'.trParams({'km': '$radiusKm'}),
                        style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                  ),
                  Icon(Icons.chevron_right_rounded, color: p.ink, size: 22),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _leading(AppPalette p, IconData icon) => Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(10)),
        child: Icon(icon, size: 19, color: p.brandText),
      );
}
