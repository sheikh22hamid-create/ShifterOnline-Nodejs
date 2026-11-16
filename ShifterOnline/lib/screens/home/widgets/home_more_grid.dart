import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../theme/widgets/section_header.dart';

class HomeMoreItem {
  const HomeMoreItem({
    required this.label,
    required this.icon,
    required this.tint,
    required this.iconColor,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final Color tint;
  final Color iconColor;
  final VoidCallback onTap;
}

/// "More on Shifter" feature grid, four per row.
class HomeMoreGrid extends StatelessWidget {
  const HomeMoreGrid({super.key, required this.items});

  final List<HomeMoreItem> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final p = AppPalette.current;
    final rows = <List<HomeMoreItem>>[];
    for (var i = 0; i < items.length; i += 4) {
      rows.add(items.sublist(i, i + 4 > items.length ? items.length : i + 4));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: 'More on Shifter'.tr),
        const SizedBox(height: AppSpace.s),
        Container(
          padding: const EdgeInsets.fromLTRB(6, 16, 6, 8),
          decoration: BoxDecoration(
            color: p.surface,
            borderRadius: BorderRadius.circular(AppRadius.hero),
            border: Border.all(color: p.line),
          ),
          child: Column(
            children: [
              for (final row in rows)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (var i = 0; i < 4; i++)
                      Expanded(child: i < row.length ? _Tile(item: row[i]) : const SizedBox.shrink()),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.item});

  final HomeMoreItem item;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return PressableScale(
      onTap: item.onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(2, 4, 2, 10),
        child: Column(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(color: item.tint, borderRadius: BorderRadius.circular(16)),
              child: Icon(item.icon, size: 24, color: item.iconColor),
            ),
            const SizedBox(height: 8),
            Text(
              item.label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppText.caption(p.ink).copyWith(fontFamily: 'Gilroy_Bold', height: 1.25),
            ),
          ],
        ),
      ),
    );
  }
}
