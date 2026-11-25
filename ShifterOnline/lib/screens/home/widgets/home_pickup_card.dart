import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../utils/address_format.dart';

/// Porter-style "Pick up from" card that overlaps the bottom of the Home header.
/// Presentational only — the tap goes to home.dart's existing pickup-change flow.
class HomePickupCard extends StatelessWidget {
  const HomePickupCard({super.key, required this.address, required this.onTap});

  final String? address;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final cleaned = cleanAddress(address);
    final shown = cleaned.isEmpty ? 'Location'.tr : cleaned;
    return PressableScale(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
          boxShadow: const [BoxShadow(color: Color(0x1A101828), blurRadius: 14, offset: Offset(0, 4))],
        ),
        child: Row(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(color: p.success, shape: BoxShape.circle),
              child: const Icon(Icons.arrow_upward_rounded, size: 17, color: Colors.white),
            ),
            const SizedBox(width: AppSpace.m),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Pick up from'.tr, style: AppText.bodyStrong(p.ink)),
                  const SizedBox(height: 2),
                  Text(
                    shown,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.body(p.inkMuted).copyWith(fontSize: 13),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpace.s),
            Icon(Icons.chevron_right_rounded, size: 22, color: p.ink),
          ],
        ),
      ),
    );
  }
}
