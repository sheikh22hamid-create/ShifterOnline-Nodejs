import 'package:flutter/material.dart';

import '../app_tokens.dart';
import 'pressable_scale.dart';

/// Main call to action: brand fill, dark (onBrand) label, 52 high, radius 12.
class AppPrimaryButton extends StatelessWidget {
  const AppPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.trailing,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  /// Optional right-aligned text, e.g. the fare.
  final String? trailing;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final enabled = onPressed != null;
    final labelStyle = AppText.bodyStrong(p.onBrand).copyWith(fontSize: 16);
    return Opacity(
      opacity: enabled ? 1 : 0.4,
      child: PressableScale(
        onTap: onPressed,
        child: Container(
          height: 52,
          width: expand ? double.infinity : null,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          decoration: BoxDecoration(
            color: p.brand,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
            mainAxisAlignment: trailing == null ? MainAxisAlignment.center : MainAxisAlignment.spaceBetween,
            children: [
              Flexible(child: Text(label, style: labelStyle, maxLines: 1, overflow: TextOverflow.ellipsis)),
              if (trailing != null) ...[
                const SizedBox(width: AppSpace.m),
                Text(trailing!, style: labelStyle),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Secondary action: surface fill with a thin border, 44 high.
class AppSecondaryButton extends StatelessWidget {
  const AppSecondaryButton({super.key, required this.label, required this.onPressed, this.icon});

  final String label;
  final VoidCallback? onPressed;
  final Widget? icon;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Opacity(
      opacity: onPressed != null ? 1 : 0.4,
      child: PressableScale(
        onTap: onPressed,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: p.surface,
            borderRadius: BorderRadius.circular(AppRadius.input),
            border: Border.all(color: p.line),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[icon!, const SizedBox(width: 6)],
              Flexible(
                child: Text(label,
                    style: AppText.bodyStrong(p.ink).copyWith(fontSize: 13),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
