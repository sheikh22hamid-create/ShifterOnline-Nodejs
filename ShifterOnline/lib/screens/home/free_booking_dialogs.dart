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
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
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

/// Information dialog explaining Free Ride Chance to customer
Future<void> showFreeRideChanceInfoDialog() async {
  await Get.dialog(
    Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xff10b981).withValues(alpha: 0.12), shape: BoxShape.circle),
              child: const Icon(Icons.card_giftcard_rounded, color: Color(0xff10b981), size: 36),
            ),
            const SizedBox(height: 16),
            Text('Free Ride Chance'.tr, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            Text(
              'As a Premium member, your instant booking automatically searches company Free Pool Vehicles first.\n\nIf a pool vehicle accepts, 100% of your trip fare will be refunded to your Shifter wallet upon completion!\n\nIf no pool vehicle is available nearby, the system automatically connects a standard verified driver so your trip is never delayed.'.tr,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, height: 1.45),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Get.back(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xff10b981),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: Text('Got it'.tr, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Eligible: the booking will be a Free Booking. True = continue.
Future<bool> showFreeBookingAppliedDialog() => _confirmDialog(
      icon: Icons.card_giftcard_rounded,
      color: Colors.green,
      title: 'Free Ride Chance Active'.tr,
      message: 'If a free pool vehicle accepts your booking, 100% of the trip amount will be credited back to your Shifter wallet.'.tr,
      continueLabel: 'Continue'.tr,
      cancelLabel: 'Cancel'.tr,
    );

/// No pool vehicle in range: the refund will NOT be given. True = proceed with the paid vehicle.
Future<bool> showNoFreeVehicleDialog() => _confirmDialog(
      icon: Icons.warning_amber_rounded,
      color: Colors.orange.shade800,
      title: 'Standard Vehicle Search'.tr,
      message: 'No free pool vehicle is nearby right now. Your booking will continue with standard verified drivers (regular fare applies).'.tr,
      continueLabel: 'Continue'.tr,
      cancelLabel: 'Cancel'.tr,
    );
