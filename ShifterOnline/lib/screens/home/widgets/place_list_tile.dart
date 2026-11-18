import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// One place row in search results / recents. The typed text (`highlight`) is shown in brand colour.
class PlaceListTile extends StatelessWidget {
  const PlaceListTile({
    super.key,
    required this.title,
    this.subtitle,
    required this.icon,
    this.highlight,
    this.trailingText,
    required this.onTap,
    this.trailing,
    this.onSave,
  });

  final String title;
  final String? subtitle;
  final IconData icon;
  final String? highlight;
  final String? trailingText;
  final VoidCallback onTap;
  final Widget? trailing;
  /// When set, a "❤ SAVE" button lets the customer save this place as an address.
  final VoidCallback? onSave;

  List<TextSpan> _titleSpans(AppPalette p) {
    final base = AppText.bodyStrong(p.ink).copyWith(fontSize: 14);
    final h = highlight?.trim() ?? '';
    final at = h.isEmpty ? -1 : title.toLowerCase().indexOf(h.toLowerCase());
    if (at < 0) return [TextSpan(text: title, style: base)];
    return [
      if (at > 0) TextSpan(text: title.substring(0, at), style: base),
      TextSpan(text: title.substring(at, at + h.length), style: base.copyWith(color: p.brandText)),
      if (at + h.length < title.length) TextSpan(text: title.substring(at + h.length), style: base),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return PressableScale(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 64),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: p.canvas, shape: BoxShape.circle),
                child: Icon(icon, size: 18, color: p.inkMuted),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text.rich(
                      TextSpan(children: _titleSpans(p)),
                      key: const ValueKey('place-title'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle != null && subtitle!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(subtitle!, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.caption(p.inkSubtle)),
                    ],
                  ],
                ),
              ),
              if (trailingText != null) ...[
                const SizedBox(width: 8),
                Text(trailingText!, style: AppText.caption(p.inkSubtle).copyWith(fontFamily: 'Gilroy_Bold')),
              ],
              if (onSave != null) ...[
                const SizedBox(width: 4),
                TextButton.icon(
                  onPressed: onSave,
                  style: TextButton.styleFrom(
                    foregroundColor: p.brandText,
                    minimumSize: const Size(44, 40),
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                  icon: Icon(Icons.favorite_border_rounded, size: 16, color: p.brandText),
                  label: Text('SAVE'.tr, style: AppText.caption(p.brandText).copyWith(fontFamily: 'Gilroy_Bold')),
                ),
              ],
              if (trailing != null) ...[const SizedBox(width: 4), trailing!],
            ],
          ),
        ),
      ),
    );
  }
}
