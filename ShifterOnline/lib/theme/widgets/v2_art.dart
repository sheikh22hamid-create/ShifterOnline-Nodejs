import 'package:flutter/material.dart';

import '../app_tokens.dart';

/// Illustration slot for the v2 redesign. Shows `assets/v2/<file>.png` when the owner has supplied it,
/// otherwise a quiet tinted placeholder with [placeholderLabel] (e.g. "H1"), never an error box.
class V2Art extends StatelessWidget {
  const V2Art({
    super.key,
    required this.asset,
    required this.placeholderLabel,
    this.width,
    this.height,
    this.fit = BoxFit.contain,
  });

  final String asset;
  final String placeholderLabel;
  final double? width;
  final double? height;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Image.asset(
        asset,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (context, _, __) => _Placeholder(label: placeholderLabel, width: width, height: height),
      ),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.label, this.width, this.height});

  final String label;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Container(
      width: width,
      height: height,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: p.brandTint.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(AppRadius.input),
      ),
      child: Text(label, style: AppText.caption(p.inkMuted)),
    );
  }
}
