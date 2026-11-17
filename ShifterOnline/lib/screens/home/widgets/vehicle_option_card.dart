import 'package:flutter/material.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// Vehicle choice on the Choose-vehicle screen. Unavailable vehicles stay tappable so the screen can explain why.
class VehicleOptionCard extends StatelessWidget {
  const VehicleOptionCard({
    super.key,
    required this.name,
    this.imageUrl,
    this.caption,
    this.tag,
    required this.selected,
    required this.available,
    required this.onTap,
  });

  final String name;
  final String? imageUrl;
  /// Fare text when available, the reason when not.
  final String? caption;
  final String? tag;
  final bool selected;
  final bool available;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final placeholder = Icon(Icons.local_shipping_outlined, color: p.inkSubtle, size: 38);
    return Opacity(
      key: const ValueKey('vehicle-card-opacity'),
      opacity: available ? 1 : 0.45,
      child: PressableScale(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: 128,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: selected ? p.brandTint : p.surface,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: selected ? p.brand : p.line, width: selected ? 1.6 : 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Container(
                  width: double.infinity,
                  color: selected ? p.surface.withValues(alpha: 0.6) : p.canvas,
                  padding: const EdgeInsets.all(8),
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: (imageUrl == null || imageUrl!.isEmpty)
                            ? Center(child: placeholder)
                            : Image.network(
                                imageUrl!,
                                fit: BoxFit.contain,
                                cacheWidth: 300,
                                errorBuilder: (_, __, ___) => Center(child: placeholder),
                              ),
                      ),
                      if (tag != null)
                        PositionedDirectional(
                          top: 0,
                          start: 0,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(5)),
                            child: Text(tag!,
                                style: AppText.caption(p.brandText).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 9.5)),
                          ),
                        ),
                      if (selected)
                        PositionedDirectional(
                          top: 0,
                          end: 0,
                          child: Icon(Icons.check_circle_rounded, color: p.brand, size: 18),
                        ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 9),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.bodyStrong(available ? p.ink : p.inkSubtle).copyWith(fontSize: 13)),
                    if (caption != null && caption!.isNotEmpty)
                      Text(
                        caption!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.caption(available ? p.inkSubtle : p.danger).copyWith(fontSize: 11),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
