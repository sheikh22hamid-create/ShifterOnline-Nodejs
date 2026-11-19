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

/// V1–V4 vehicle picture for a vehicle name ("Bike", "E Loader", "3 Wheeler", "Tata Ace"…).
/// Unknown names get the 4 wheeler (V4), the most common booking.
String vehicleArtFor(String? name) {
  final n = (name ?? '').toLowerCase().replaceAll(RegExp(r'[\s_-]+'), ' ');
  if (RegExp(r'bike|2 ?wheel|two wheel|scooter|motorcycle').hasMatch(n)) return 'assets/v2/vehicle_bike.png';
  if (RegExp(r'e ?loader|e ?rickshaw|electric').hasMatch(n)) return 'assets/v2/vehicle_e_loader.png';
  if (RegExp(r'3 ?wheel|three wheel|tempo|auto').hasMatch(n)) return 'assets/v2/vehicle_three_wheeler.png';
  return 'assets/v2/vehicle_four_wheeler.png';
}
