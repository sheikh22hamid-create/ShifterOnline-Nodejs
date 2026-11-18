import 'package:flutter/material.dart';

import '../app_tokens.dart';
import 'pressable_scale.dart';

/// Surface card with a soft shadow and no border; `selected` switches to the brand outline and tint.
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
        border: selected ? Border.all(color: p.brand, width: 1.5) : null,
        boxShadow: selected ? null : AppShadow.card,
      ),
      child: Padding(padding: padding, child: child),
    );
    if (onTap == null) return card;
    return PressableScale(onTap: onTap, child: card);
  }
}
