import 'package:flutter/material.dart';

import '../../../theme/app_tokens.dart';

/// "Important booking guidelines" card on Review & Pay.
class BookingGuidelines extends StatelessWidget {
  const BookingGuidelines({super.key, required this.title, required this.items});

  final String title;
  final List<({IconData icon, String text})> items;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.warningTint,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: p.warning.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.info_outline_rounded, color: p.warning, size: 18),
              const SizedBox(width: 8),
              Expanded(child: Text(title, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14))),
            ],
          ),
          for (final item in items) ...[
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(item.icon, color: p.warning, size: 16),
                const SizedBox(width: 8),
                Expanded(child: Text(item.text, style: AppText.caption(p.ink).copyWith(fontSize: 12.5, height: 1.4))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
