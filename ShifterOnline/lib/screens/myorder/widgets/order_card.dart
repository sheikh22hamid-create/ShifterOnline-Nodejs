import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../theme/widgets/route_marker.dart';

/// Porter-style order card (Orders tab): vehicle + date + amount, pickup/drop box, details,
/// status chip and the Favourite / Book Again actions. Presentational only.
class OrderCard extends StatelessWidget {
  const OrderCard({
    super.key,
    required this.title,
    this.vehicleName,
    this.amount,
    required this.status,
    required this.date,
    required this.pickup,
    required this.drop,
    this.note,
    this.details = const [],
    this.isFavorite = false,
    this.showActions = true,
    this.onTap,
    this.onFavorite,
    this.onBookAgain,
  });

  /// Order number, e.g. "#123" — the heading when there is no vehicle name.
  final String title;
  final String? vehicleName;
  final String? amount;
  final String status;
  final String date;
  final String pickup;
  final String drop;
  final String? note;
  final List<MapEntry<String, String>> details;
  final bool isFavorite;
  final bool showActions;
  final VoidCallback? onTap;
  final VoidCallback? onFavorite;
  final VoidCallback? onBookAgain;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final ({Color fg, Color tint}) chip = switch (status) {
      "Pending" => (fg: p.warning, tint: p.warningTint),
      "Processing" => (fg: p.brandText, tint: p.brandTint),
      "On Route" || "Completed" => (fg: p.successText, tint: p.successTint),
      "Cancelled" => (fg: p.danger, tint: p.dangerTint),
      _ => (fg: p.inkMuted, tint: p.canvas),
    };
    final hasVehicle = vehicleName != null && vehicleName!.trim().isNotEmpty && vehicleName != 'null';
    final hasAmount = amount != null && amount!.trim().isNotEmpty;
    final hasNote = note != null && note!.trim().isNotEmpty && note != 'null';

    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
          boxShadow: AppShadow.card,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // ── Header: vehicle · date · amount ──────────────────────────────
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: p.canvas, borderRadius: BorderRadius.circular(12)),
                  child: Icon(Icons.local_shipping_outlined, color: p.inkMuted, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(hasVehicle ? vehicleName! : title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.bodyStrong(p.ink).copyWith(fontSize: 16)),
                      const SizedBox(height: 2),
                      Text(hasVehicle ? '$date · $title' : date,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.caption(p.inkMuted).copyWith(fontSize: 12.5)),
                    ],
                  ),
                ),
                if (hasAmount) ...[
                  const SizedBox(width: 8),
                  Text(amount!, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 16)),
                ],
                Icon(Icons.chevron_right_rounded, color: p.inkSubtle, size: 22),
              ],
            ),
            const SizedBox(height: 12),

            // ── Pickup / drop box ────────────────────────────────────────────
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: p.canvas, borderRadius: BorderRadius.circular(12)),
              child: Column(
                children: [
                  _place(p, const RouteMarker.pickup(size: 20), pickup),
                  const SizedBox(height: 10),
                  _place(p, const RouteMarker.drop(size: 20), drop),
                ],
              ),
            ),

            if (hasNote) ...[
              const SizedBox(height: 10),
              Text(note!, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
            ],

            if (details.isNotEmpty) ...[
              const SizedBox(height: 10),
              for (final row in details)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(width: 104, child: Text(row.key.tr, style: AppText.caption(p.inkSubtle))),
                      Expanded(
                        child: Text(row.value,
                            style: AppText.caption(p.ink).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 12.5)),
                      ),
                    ],
                  ),
                ),
            ],

            const SizedBox(height: 12),
            // ── Footer: status + actions ─────────────────────────────────────
            Row(
              children: [
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(color: chip.tint, borderRadius: BorderRadius.circular(8)),
                    child: Text(status.tr,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.caption(chip.fg).copyWith(fontFamily: 'Gilroy_Bold')),
                  ),
                ),
                const Spacer(),
                if (showActions) ...[
                  IconButton(
                    tooltip: (isFavorite ? 'Favorite' : 'Add Fav Order').tr,
                    onPressed: onFavorite,
                    icon: Icon(
                      isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                      color: isFavorite ? p.danger : p.inkMuted,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Flexible(
                    flex: 3,
                    child: OutlinedButton(
                      onPressed: onBookAgain,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: p.brandText,
                        side: BorderSide(color: p.brand, width: 1.5),
                        minimumSize: const Size(0, 40),
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: Text('Book Again'.tr,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 13.5)),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _place(AppPalette p, Widget marker, String text) => Row(
        children: [
          marker,
          const SizedBox(width: 10),
          Expanded(
            child: Text(text,
                maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 13)),
          ),
        ],
      );
}
