import 'package:flutter/material.dart';

import '../app_tokens.dart';

enum AppBannerTone { info, success, warning, danger, brand }

/// Tinted message strip: icon, optional title, text and an optional text action.
class AppInfoBanner extends StatelessWidget {
  const AppInfoBanner({
    super.key,
    required this.tone,
    required this.icon,
    required this.text,
    this.title,
    this.actionLabel,
    this.onAction,
  });

  final AppBannerTone tone;
  final IconData icon;
  final String text;
  final String? title;
  final String? actionLabel;
  final VoidCallback? onAction;

  ({Color tint, Color fg}) _colors(AppPalette p) => switch (tone) {
        AppBannerTone.success => (tint: p.successTint, fg: p.successText),
        AppBannerTone.warning => (tint: p.warningTint, fg: p.warning),
        AppBannerTone.danger => (tint: p.dangerTint, fg: p.danger),
        AppBannerTone.brand => (tint: p.brandTint, fg: p.brandText),
        AppBannerTone.info => (tint: p.canvas, fg: p.inkMuted),
      };

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final c = _colors(p);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.tint, borderRadius: BorderRadius.circular(14)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: c.fg),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null) ...[
                  Text(title!, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                  const SizedBox(height: 2),
                ],
                Text(text, style: AppText.caption(p.ink).copyWith(fontSize: 13, height: 1.4)),
                if (actionLabel != null)
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton(
                      onPressed: onAction,
                      style: TextButton.styleFrom(
                        minimumSize: const Size(44, 44),
                        padding: EdgeInsets.zero,
                        foregroundColor: c.fg,
                      ),
                      child: Text(actionLabel!, style: AppText.bodyStrong(c.fg).copyWith(fontSize: 13)),
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
