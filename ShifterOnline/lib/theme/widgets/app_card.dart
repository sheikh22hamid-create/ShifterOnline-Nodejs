import 'package:flutter/material.dart';

import '../app_tokens.dart';
import 'pressable_scale.dart';

/// Surface card with a thin border; `selected` switches to the brand outline and tint.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
    this.selected = false,
  });

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final card = DecoratedBox(
      decoration: BoxDecoration(
        color: selected ? p.brandTint : p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: selected ? p.brand : p.line, width: selected ? 1.5 : 1),
      ),
      child: Padding(padding: padding, child: child),
    );
    if (onTap == null) return card;
    return PressableScale(onTap: onTap, child: card);
  }
}
