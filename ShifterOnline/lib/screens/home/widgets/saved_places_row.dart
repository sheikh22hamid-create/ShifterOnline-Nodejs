import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/app_skeleton.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// Saved places (Home / Work / Other) on drop search — moved here from Home (Porter puts them in search).
/// Presentational only: the screen loads the list and owns every tap.
class SavedPlacesRow extends StatelessWidget {
  const SavedPlacesRow({
    super.key,
    required this.places,
    required this.loading,
    required this.onSelect,
    required this.onAdd,
    required this.onManage,
  });

  final List<Map<String, dynamic>> places;
  final bool loading;
  final ValueChanged<Map<String, dynamic>> onSelect;
  final VoidCallback onAdd;
  final VoidCallback onManage;

  /// Same rule the Home quick row used: the API's "Office" type is shown as "Work".
  static String titleFor(Map<String, dynamic> place) {
    final type = place['type']?.toString() ?? 'Other';
    return type.toLowerCase() == 'office' ? 'Work' : type;
  }

  static String iconFor(Map<String, dynamic> place) {
    switch (place['type']?.toString().toLowerCase()) {
      case 'home':
        return 'assets/selecthome.png';
      case 'office':
        return 'assets/selectoffice.png';
      default:
        return 'assets/selectothers.png';
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 8, 0),
          child: Row(
            children: [
              Expanded(
                child: Text('Saved places'.tr,
                    style: AppText.caption(p.inkSubtle).copyWith(fontFamily: 'Gilroy_Bold', letterSpacing: 0.4)),
              ),
              TextButton(
                onPressed: onManage,
                style: TextButton.styleFrom(foregroundColor: p.brandText, minimumSize: const Size(44, 40)),
                child: Text('Manage'.tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 13)),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 52,
          child: loading
              ? ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                  children: const [
                    AppSkeleton(width: 96, height: 40, radius: 999),
                    SizedBox(width: 8),
                    AppSkeleton(width: 96, height: 40, radius: 999),
                  ],
                )
              : ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                  children: [
                    for (final place in places) ...[
                      _chip(p, label: titleFor(place), leading: Image.asset(iconFor(place), width: 18, height: 18),
                          onTap: () => onSelect(place)),
                      const SizedBox(width: 8),
                    ],
                    _chip(p, label: 'Add'.tr, leading: Icon(Icons.add_rounded, size: 18, color: p.brandText), onTap: onAdd),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _chip(AppPalette p, {required String label, required Widget leading, required VoidCallback onTap}) {
    return PressableScale(
      onTap: onTap,
      semanticLabel: label,
      child: Container(
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(999),
          boxShadow: AppShadow.card,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            leading,
            const SizedBox(width: 6),
            Text(label, maxLines: 1, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
