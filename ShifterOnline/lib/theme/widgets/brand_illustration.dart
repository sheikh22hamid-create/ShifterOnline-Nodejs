import 'package:flutter/material.dart';

import '../app_tokens.dart';
import 'truck_road.dart';

enum BrandIllustrationKind { delivery, otp, profile }

/// Flat brand illustrations that replace the old AI stock images (which carried wrong brand names).
class BrandIllustration extends StatelessWidget {
  const BrandIllustration({super.key, required this.kind, required this.height});

  final BrandIllustrationKind kind;
  final double height;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return ExcludeSemantics(
      child: SizedBox(
        height: height,
        width: double.infinity,
        child: DecoratedBox(
          decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(AppRadius.hero)),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.hero),
            child: switch (kind) {
              BrandIllustrationKind.delivery => Stack(
                  children: [
                    Positioned(
                      right: -height * 0.3,
                      top: -height * 0.4,
                      child: Container(
                        width: height * 1.2,
                        height: height * 1.2,
                        decoration: BoxDecoration(shape: BoxShape.circle, color: p.brand.withValues(alpha: 0.08)),
                      ),
                    ),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: height * 0.12,
                      height: 44,
                      child: const RepaintBoundary(child: TruckRoad()),
                    ),
                  ],
                ),
              BrandIllustrationKind.otp => _iconScene(p, Icons.phone_iphone_rounded, Icons.lock_rounded),
              BrandIllustrationKind.profile => _iconScene(p, Icons.person_rounded, Icons.edit_rounded),
            },
          ),
        ),
      ),
    );
  }

  Widget _iconScene(AppPalette p, IconData main, IconData badge) {
    final size = height * 0.62;
    return Center(
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(color: p.surface, shape: BoxShape.circle),
            child: Icon(main, size: size * 0.55, color: p.brand),
          ),
          Positioned(
            right: -4,
            bottom: -2,
            child: Container(
              width: size * 0.38,
              height: size * 0.38,
              decoration: BoxDecoration(
                color: p.ink,
                shape: BoxShape.circle,
                border: Border.all(color: p.brandTint, width: 3),
              ),
              child: Icon(badge, size: size * 0.18, color: p.surface),
            ),
          ),
        ],
      ),
    );
  }
}
