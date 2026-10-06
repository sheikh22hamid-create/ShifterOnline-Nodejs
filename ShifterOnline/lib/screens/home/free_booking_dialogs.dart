import 'package:flutter/material.dart';
import 'package:get/get.dart';

Future<bool> _confirmDialog({
  required IconData icon,
  required Color color,
  required String title,
  required String message,
  required String continueLabel,
  required String cancelLabel,
}) async {
  final result = await Get.dialog<bool>(
    Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: color.withOpacity(0.12), shape: BoxShape.circle),
              child: Icon(icon, color: color, size: 36),
            ),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, height: 1.4)),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(child: OutlinedButton(onPressed: () => Get.back(result: false), child: Text(cancelLabel))),
                const SizedBox(width: 12),
                Expanded(child: ElevatedButton(onPressed: () => Get.back(result: true), child: Text(continueLabel))),
              ],
            ),
          ],
        ),
      ),
    ),
    barrierDismissible: false,
  );
  return result ?? false;
}

/// Eligible: the booking will be a Free Booking. True = continue.
Future<bool> showFreeBookingAppliedDialog() => _confirmDialog(
      icon: Icons.card_giftcard_rounded,
      color: Colors.green,
      title: 'Free Booking applied'.tr,
      message: 'After the trip is completed and paid, the full trip amount will be credited to your Shifter wallet.'.tr,
      continueLabel: 'Continue'.tr,
      cancelLabel: 'Cancel'.tr,
    );

/// No pool vehicle in range: the refund will NOT be given. True = proceed with the paid vehicle.
Future<bool> showNoFreeVehicleDialog() => _confirmDialog(
      icon: Icons.warning_amber_rounded,
      color: Colors.orange.shade800,
      title: 'No free vehicle available'.tr,
      message: 'A free vehicle is not available near your pickup right now. If you continue with a paid vehicle you will NOT receive any refund for this trip.'.tr,
      continueLabel: 'Continue (no refund)'.tr,
      cancelLabel: 'Cancel'.tr,
    );
