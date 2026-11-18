import 'package:flutter/material.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// Porter-style vehicle row on Select Vehicle. The selected vehicle grows into a large card (bigger image,
/// brand outline + tint); the rest are compact rows. Unavailable vehicles stay tappable so the screen can
/// explain why.
class VehicleOptionCard extends StatelessWidget {
  const VehicleOptionCard({
    super.key,
    required this.name,
    this.imageUrl,
    this.meta,
    this.price,
    this.unavailableText,
    this.tag,
    required this.selected,
    required this.available,
    required this.onTap,
  });

  final String name;
  final String? imageUrl;

  /// "500 kg · 4 mins" — built by the screen from the parts it has.
  final String? meta;

  /// Fare text, shown when available.
  final String? price;

  /// Reason, shown instead of the price when not available.
  final String? unavailableText;
  final String? tag;
  final bool selected;
  final bool available;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final imageSize = selected ? 96.0 : 56.0;
    final placeholder = Icon(Icons.local_shipping_outlined, color: p.inkSubtle, size: selected ? 44 : 30);
    final right = available ? price : unavailableText;
    return Opacity(
      key: const ValueKey('vehicle-card-opacity'),
      opacity: available ? 1 : 0.45,
      child: PressableScale(
        onTap: onTap,
        semanticLabel: name,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: EdgeInsets.all(selected ? 14 : 10),
          decoration: BoxDecoration(
            color: selected ? p.brandTint : p.surface,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: selected ? Border.all(color: p.brand, width: 1.5) : null,
            boxShadow: selected ? null : AppShadow.card,
          ),
          child: Row(
            children: [
              SizedBox(
                key: const ValueKey('vehicle-image-slot'),
                width: imageSize,
                height: imageSize,
                child: (imageUrl == null || imageUrl!.isEmpty)
                    ? Center(child: placeholder)
                    : Image.network(
                        imageUrl!,
                        fit: BoxFit.contain,
                        cacheWidth: 300,
                        errorBuilder: (_, __, ___) => Center(child: placeholder),
                      ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Wrap(
                      spacing: 6,
                      runSpacing: 2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.bodyStrong(available ? p.ink : p.inkSubtle).copyWith(fontSize: 16)),
                        if (tag != null)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(5)),
                            child: Text(tag!,
                                style: AppText.caption(p.brandText).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 10)),
                          ),
                      ],
                    ),
                    if (meta != null && meta!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(meta!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
                    ],
                  ],
                ),
              ),
              if (right != null && right.isNotEmpty) ...[
                const SizedBox(width: 8),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 110),
                  child: Text(
                    right,
                    textAlign: TextAlign.end,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: available
                        ? AppText.bodyStrong(p.ink).copyWith(fontSize: 16)
                        : AppText.caption(p.danger).copyWith(fontSize: 12),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
