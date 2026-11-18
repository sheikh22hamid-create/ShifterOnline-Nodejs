import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';

/// "RK" from "Ramesh Kumar": first letter of the first two words.
String nameInitials(String name) {
  final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2);
  return words.map((w) => w[0].toUpperCase()).join();
}

/// Top of a completed trip: green tick that pops in, "Delivered successfully", order line.
class TripCompleteHeader extends StatelessWidget {
  final String subtitle;
  const TripCompleteHeader({super.key, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final still = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final tick = Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(color: p.successTint, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(color: p.success, shape: BoxShape.circle),
        child: const Icon(Icons.check_rounded, color: Colors.white, size: 28),
      ),
    );
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 20),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        children: [
          still
              ? tick
              : TweenAnimationBuilder<double>(
                  tween: Tween<double>(begin: 0, end: 1),
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.easeOutBack,
                  builder: (_, v, child) => Transform.scale(scale: v, child: child),
                  child: tick,
                ),
          const SizedBox(height: 12),
          Text(
            'Delivered successfully'.tr,
            textAlign: TextAlign.center,
            style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 20, color: p.ink),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            textAlign: TextAlign.center,
            style: TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 13, color: p.inkSubtle, height: 1.35),
          ),
        ],
      ),
    );
  }
}

/// Inline "How was your trip?" card. Tapping a star opens the full rating sheet with that rating.
class RateTripCard extends StatelessWidget {
  final String driverName;
  final String vehicleName;
  final ValueChanged<int> onRate;

  const RateTripCard({super.key, required this.driverName, required this.vehicleName, required this.onRate});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final name = driverName.trim().isNotEmpty ? driverName.trim() : 'Delivery Partner'.tr;
    final initials = nameInitials(driverName);
    final line = [name, if (vehicleName.trim().isNotEmpty) vehicleName.trim()].join(' · ');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: p.brandTint, shape: BoxShape.circle),
                child: initials.isEmpty
                    ? Icon(Icons.person_rounded, color: p.brandText, size: 24)
                    : Text(initials, style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 16, color: p.brandText)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('How was your trip?'.tr,
                        style: TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 16, color: p.ink)),
                    const SizedBox(height: 2),
                    Text(line,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 13, color: p.inkSubtle)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(5, (i) {
              final stars = i + 1;
              return Semantics(
                button: true,
                label: 'Rate $stars stars',
                excludeSemantics: true,
                child: InkResponse(
                  onTap: () => onRate(stars),
                  radius: 26,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                    child: Icon(Icons.star_outline_rounded, size: 40, color: p.brand),
                  ),
                ),
              );
            }),
          ),
          const SizedBox(height: 4),
          Text('Tap a star to rate'.tr,
              style: TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 12, color: p.inkSubtle)),
        ],
      ),
    );
  }
}
