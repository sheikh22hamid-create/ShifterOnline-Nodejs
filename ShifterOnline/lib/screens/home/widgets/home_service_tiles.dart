import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../theme/widgets/v2_art.dart';

/// Porter-style 2×2 service tiles on Home: Book Now, Schedule, Low Fare, Customise Order.
/// Presentational only — each tile calls the handler home.dart already uses for that booking mode.
class HomeServiceTiles extends StatelessWidget {
  const HomeServiceTiles({
    super.key,
    required this.onBookNow,
    required this.onSchedule,
    required this.onLowFare,
    required this.onCustomise,
    this.scheduleEnabled = true,
  });

  final VoidCallback onBookNow;
  final VoidCallback onSchedule;
  final VoidCallback onLowFare;
  final VoidCallback onCustomise;
  final bool scheduleEnabled;

  @override
  Widget build(BuildContext context) {
    final tiles = <Widget>[
      _ServiceTile(
          art: 'assets/v2/tile_book_now.png', artLabel: 'T1', label: 'Book Now'.tr, sub: 'Instant pickup'.tr, onTap: onBookNow),
      if (scheduleEnabled)
        _ServiceTile(
            art: 'assets/v2/tile_schedule.png', artLabel: 'T2', label: 'Schedule'.tr, sub: 'Pick date and time'.tr, onTap: onSchedule),
      _ServiceTile(
          art: 'assets/v2/tile_low_fare.png', artLabel: 'T3', label: 'Low Fare'.tr, sub: 'Next day, lower price'.tr, onTap: onLowFare),
      _ServiceTile(
          art: 'assets/v2/tile_customise.png', artLabel: 'T4', label: 'Customise Order'.tr, sub: 'Offer your own fare'.tr, onTap: onCustomise),
    ];
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      if (rows.isNotEmpty) rows.add(const SizedBox(height: AppSpace.m));
      rows.add(IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: tiles[i]),
            const SizedBox(width: AppSpace.m),
            Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox.shrink()),
          ],
        ),
      ));
    }
    return Column(mainAxisSize: MainAxisSize.min, children: rows);
  }
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({
    required this.art,
    required this.artLabel,
    required this.label,
    required this.sub,
    required this.onTap,
  });

  final String art;
  final String artLabel;
  final String label;
  final String sub;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return PressableScale(
      onTap: onTap,
      semanticLabel: label,
      child: Container(
        constraints: const BoxConstraints(minHeight: 132),
        padding: const EdgeInsets.all(AppSpace.m),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
          boxShadow: AppShadow.card,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            V2Art(asset: art, placeholderLabel: artLabel, height: 60, fit: BoxFit.contain),
            const SizedBox(height: AppSpace.s),
            Row(
              children: [
                Expanded(
                  child: Text(label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodyStrong(p.ink)),
                ),
                Icon(Icons.chevron_right_rounded, size: 20, color: p.ink),
              ],
            ),
            const SizedBox(height: 2),
            Text(sub,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.caption(p.inkMuted)),
          ],
        ),
      ),
    );
  }
}
