import 'package:flutter/material.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// Compact vehicle chip for the horizontal vehicle-type strip on Select Vehicle (Porter-style).
/// Every vehicle type is visible at a glance; the selected one gets the brand outline + tint.
/// Unavailable vehicles stay tappable (greyed) so the screen can explain why.
class VehicleStripChip extends StatelessWidget {
  const VehicleStripChip({
    super.key,
    required this.name,
    this.imageUrl,
    this.price,
    this.unavailableText,
    this.tag,
    required this.selected,
    required this.available,
    required this.onTap,
  });

  final String name;
  final String? imageUrl;

  /// Starting fare text (e.g. "from ₹368"), shown when available.
  final String? price;

  /// Short reason, shown instead of the price when not available.
  final String? unavailableText;
  final String? tag;
  final bool selected;
  final bool available;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final placeholder = Icon(Icons.local_shipping_outlined, color: p.inkSubtle, size: 30);
    final right = available ? price : unavailableText;
    return Opacity(
      opacity: available ? 1 : 0.45,
      child: PressableScale(
        onTap: onTap,
        semanticLabel: name,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          width: 112,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
          decoration: BoxDecoration(
            color: selected ? p.brandTint : p.surface,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: Border.all(color: selected ? p.brand : p.line, width: selected ? 1.5 : 1),
            boxShadow: selected ? null : AppShadow.card,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(
                height: 46,
                child: (imageUrl == null || imageUrl!.isEmpty)
                    ? Center(child: placeholder)
                    : Image.network(
                        imageUrl!,
                        fit: BoxFit.contain,
                        cacheWidth: 240,
                        errorBuilder: (_, __, ___) => Center(child: placeholder),
                      ),
              ),
              const SizedBox(height: 6),
              Text(
                name,
                maxLines: 2,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: AppText.bodyStrong(available ? p.ink : p.inkSubtle).copyWith(fontSize: 12.5, height: 1.1),
              ),
              const SizedBox(height: 4),
              Text(
                (right == null || right.isEmpty) ? '-' : right,
                maxLines: 1,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: available
                    ? AppText.bodyStrong(selected ? p.brandText : p.ink).copyWith(fontSize: 13)
                    : AppText.caption(p.danger).copyWith(fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
