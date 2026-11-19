import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// Home, under Free Ride Chance: "Where to?" with the customer's saved places (Home / Work / Other) as chips
/// and their last few searched drops. A tap starts a booking to that place. Hidden when there is nothing to show.
/// Presentational only: home.dart loads the lists and owns every tap.
class HomeRecentPlaces extends StatelessWidget {
  const HomeRecentPlaces({
    super.key,
    required this.saved,
    required this.recents,
    required this.onSaved,
    required this.onRecent,
    required this.onSeeAll,
    this.maxRecents = 3,
  });

  final List<Map<String, dynamic>> saved;
  final List<Map<String, dynamic>> recents;
  final ValueChanged<Map<String, dynamic>> onSaved;
  final ValueChanged<Map<String, dynamic>> onRecent;
  final VoidCallback onSeeAll;
  final int maxRecents;

  static String _text(Object? v) {
    final s = v?.toString().trim() ?? '';
    return s == 'null' ? '' : s;
  }

  /// The API's "Office" is shown as "Work", like the search screen.
  static String savedTitle(Map<String, dynamic> place) {
    final type = _text(place['type']);
    if (type.isEmpty) return 'Other';
    return type.toLowerCase() == 'office' ? 'Work' : type;
  }

  /// Short place hint for a saved chip: the first part of its address ("Vijay Nagar" from "Vijay Nagar, Indore…"),
  /// so two places of the same type can be told apart.
  static String savedArea(Map<String, dynamic> place) {
    for (final key in ['landmark', 'address']) {
      final first = _text(place[key]).split(',').first.trim();
      if (first.isNotEmpty) return first;
    }
    return '';
  }

  static IconData savedIcon(Map<String, dynamic> place) {
    switch (_text(place['type']).toLowerCase()) {
      case 'home':
        return Icons.home_rounded;
      case 'office':
      case 'work':
        return Icons.work_rounded;
      default:
        return Icons.place_rounded;
    }
  }

  /// Recents with a usable address and position, newest first, at most [max].
  static List<Map<String, dynamic>> usableRecents(List<Map<String, dynamic>> all, {int max = 3}) => all
      .where((r) => _text(r['address']).isNotEmpty && r['lat'] is num && r['lng'] is num)
      .take(max)
      .toList();

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final rows = usableRecents(recents, max: maxRecents);
    if (saved.isEmpty && rows.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Where to?'.tr, style: AppText.section(p.ink))),
              TextButton(
                onPressed: onSeeAll,
                style: TextButton.styleFrom(foregroundColor: p.brandText, minimumSize: const Size(48, 40)),
                child: Text('Search'.tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 14)),
              ),
            ],
          ),
          if (saved.isNotEmpty) ...[
            const SizedBox(height: 6),
            SizedBox(
              height: 40,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.only(right: 8),
                itemCount: saved.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) => _SavedChip(place: saved[i], onTap: () => onSaved(saved[i])),
              ),
            ),
            const SizedBox(height: 6),
          ],
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0 || saved.isNotEmpty) Divider(height: 1, indent: 52, endIndent: 8, color: p.divider),
            _RecentRow(place: rows[i], onTap: () => onRecent(rows[i])),
          ],
        ],
      ),
    );
  }
}

class _SavedChip extends StatelessWidget {
  const _SavedChip({required this.place, required this.onTap});
  final Map<String, dynamic> place;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return PressableScale(
      onTap: onTap,
      semanticLabel: HomeRecentPlaces.savedTitle(place).tr,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: p.brandTint,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(HomeRecentPlaces.savedIcon(place), size: 18, color: p.brandText),
            const SizedBox(width: 6),
            Text(HomeRecentPlaces.savedTitle(place).tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 14)),
            if (HomeRecentPlaces.savedArea(place).isNotEmpty) ...[
              Text(' · ', style: AppText.body(p.brandText).copyWith(fontSize: 14)),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 130),
                child: Text(HomeRecentPlaces.savedArea(place),
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body(p.ink).copyWith(fontSize: 13.5)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _RecentRow extends StatelessWidget {
  const _RecentRow({required this.place, required this.onTap});
  final Map<String, dynamic> place;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final address = HomeRecentPlaces._text(place['address']);
    final name = HomeRecentPlaces._text(place['name']);
    final title = name.isNotEmpty ? name : address;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 60),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(0, 10, 8, 10),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(color: p.canvas, shape: BoxShape.circle),
                child: Icon(Icons.history_rounded, size: 20, color: p.inkMuted),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14.5)),
                    if (address.isNotEmpty && address != title) ...[
                      const SizedBox(height: 2),
                      Text(address, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption(p.inkSubtle).copyWith(fontSize: 12.5)),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right_rounded, color: p.inkSubtle, size: 22),
            ],
          ),
        ),
      ),
    );
  }
}
