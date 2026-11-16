import 'package:flutter/material.dart';

import '../app_tokens.dart';
import 'pressable_scale.dart';

/// One choice in a single-select list (e.g. payment method).
class AppRadioTile extends StatelessWidget {
  const AppRadioTile({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.badge,
    required this.selected,
    required this.onTap,
    this.iconColor,
    this.enabled = true,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final String? badge;
  final bool selected;
  final VoidCallback? onTap;
  final Color? iconColor;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Semantics(
      selected: selected,
      inMutuallyExclusiveGroup: true,
      child: Opacity(
        opacity: enabled ? 1 : 0.45,
        child: PressableScale(
          onTap: enabled ? onTap : null,
          child: Container(
            constraints: const BoxConstraints(minHeight: 64),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: selected ? p.brandTint : p.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: selected ? p.brand : p.line, width: selected ? 1.5 : 1),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: selected ? p.surface : p.canvas,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 20, color: iconColor ?? p.ink),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(title, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                          if (badge != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(color: p.successTint, borderRadius: BorderRadius.circular(5)),
                              child: Text(badge!,
                                  style: AppText.caption(p.successText).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 10)),
                            ),
                        ],
                      ),
                      if (subtitle != null) ...[
                        const SizedBox(height: 2),
                        Text(subtitle!, style: AppText.caption(p.inkMuted)),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: p.surface,
                    border: Border.all(color: selected ? p.brand : p.line, width: selected ? 6 : 2),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
