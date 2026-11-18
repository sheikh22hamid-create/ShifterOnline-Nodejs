import 'package:flutter/material.dart';

import '../app_tokens.dart';
import 'pressable_scale.dart';

/// Porter-style grouped card (Account, settings lists): white rounded card, optional bold title,
/// rows separated by thin indented dividers.
class AppGroupCard extends StatelessWidget {
  const AppGroupCard({super.key, this.title, required this.children});

  final String? title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (title != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
              child: Text(title!, style: AppText.section(p.ink)),
            ),
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(height: 1, indent: 62, color: p.divider),
            children[i],
          ],
        ],
      ),
    );
  }
}

/// One row in an [AppGroupCard]: icon box, title, optional subtitle, chevron (or a custom trailing).
class AppMenuRow extends StatelessWidget {
  const AppMenuRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.danger = false,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final bool danger;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return PressableScale(
      onTap: onTap,
      semanticLabel: title,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: danger ? p.dangerTint : p.brandTint,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 19, color: danger ? p.danger : p.brandText),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title, style: AppText.bodyStrong(danger ? p.danger : p.ink).copyWith(fontSize: 15)),
                    if (subtitle != null && subtitle!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(subtitle!, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 4),
              trailing ??
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Icon(Icons.chevron_right_rounded, color: p.inkSubtle, size: 22),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}
